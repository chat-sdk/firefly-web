import { BehaviorSubject, Observable } from 'rxjs'
import { filter, flatMap } from 'rxjs/operators'

import { ErrorMessage } from '../error-messages'
import { Event } from '../events'
import { EventType } from '../events/event-type'
import { ListData } from '../events/list-data'
import { MultiQueueSubject } from '../firebase/rx/multi-queue-subject'
import { FirebaseService } from '../firebase/service/firebase-service'
import { Keys } from '../firebase/service/keys'
import { MuteService } from '../firebase/service/mute-serve'
import { Path } from '../firebase/service/path'
import { Paths } from '../firebase/service/paths'
import { FireStreamStore } from '../firestream-store'
import { IChat } from '../interfaces/chat'
import { Consumer } from '../interfaces/consumer'
import { IJsonObject } from '../interfaces/json'
import { ISendable } from '../interfaces/sendable'
import { DeliveryReceipt } from '../message/delivery-receipt'
import { Invitation } from '../message/invitation'
import { Message } from '../message/message'
import { TextMessage } from '../message/text-message'
import { TypingState } from '../message/typing-state'
import { FireStreamUser } from '../namespace/firestream-user'
import { DeliveryReceiptType } from '../types/delivery-receipt-type'
import { InvitationType } from '../types/invitation-type'
import { RoleType } from '../types/role-type'
import { TypingStateType } from '../types/typing-state-type'
import { ArrayUtils } from '../utils/array-utils'
import { AbstractChat } from './abstract-chat'
import { Meta } from './meta'
import { Send } from './send'
import { DataProvider, User } from './user'

export class Chat extends AbstractChat implements IChat {

    protected id: string
    protected joined?: Date
    protected meta = new Meta()

    protected users = new Array<User>()
    protected userEvents = new MultiQueueSubject<Event<User>>()

    protected nameChangedEvents = new BehaviorSubject<string>('')
    protected imageURLChangedEvents = new BehaviorSubject<string>('')
    protected customDataChangedEvents = new BehaviorSubject<IJsonObject>({})

    constructor(id: string, joined?: Date, meta?: Meta) {
        super()
        this.id = id
        this.joined = joined || this.joined
        this.meta = meta || this.meta
    }

    getId(): string {
        return this.id
    }

    async connect(): Promise<void> {

        FireStreamStore.debug('Connect to chat: ' + this.id)

        // If delivery receipts are enabled, send the delivery receipt
        if (FireStreamStore.config.deliveryReceiptsEnabled) {
            this.sm.add(this.getSendableEvents()
                    .getMessages()
                    .allEvents()
                    .pipe(filter(this.deliveryReceiptFilter()))
                    .pipe(flatMap(event => this.markReceived(event.get())))
                    .subscribe(this))
        }

        this.sm.add(this.listChangeOn(Paths.chatUsersPath(this.id)).subscribe(listEvent => {
            const userEvent = listEvent.to(User.from(listEvent))
            const user = userEvent.get()

            this.users = ArrayUtils.remove(this.users, user)
            if (!userEvent.typeIs(EventType.Removed)) {
                this.users.push(user)
            }

            this.userEvents.next(userEvent)
        }, this.error))

        // Handle name and image change
        this.sm.add(FirebaseService.chat.metaOn(this.getId()).subscribe(newMeta => {
            if (!newMeta) return
            if (newMeta.getName() && newMeta.getName() != this.meta.getName()) {
                this.meta.setName(newMeta.getName())
                this.nameChangedEvents.next(newMeta.getName())
            }
            if (newMeta.getImageURL() && newMeta.getImageURL() != this.meta.getImageURL()) {
                this.meta.setImageURL(newMeta.getImageURL())
                this.imageURLChangedEvents.next(newMeta.getImageURL())
            }
            this.meta.setCreated(newMeta.getCreated() || this.meta.getCreated())
        }, this.error))

        await super.connect()
    }

    async leave(): Promise<void> {
        if (this.getMyRoleType()?.equals(RoleType.owner()) && this.getUsers().length > 1) {
            if (this.getUsers().length > 1) {
                throw new Error(ErrorMessage.group_must_be_empty_to_close)
            } else {
                // TODO: This code block will never be reached
                return this.delete().then(this.disconnect)
            }
        }
        return this.removeUser(User.expectCurrentUser()).then(this.disconnect)
    }

    protected delete(): Promise<void> {
        return FirebaseService.chat.delete(this.getId())
    }

    getName(): string {
        return this.meta.getName()
    }

    async setName(name: string): Promise<void> {
        if (!this.hasPermission(RoleType.admin())) {
            throw this.adminPermissionRequired()
        } else if (this.meta.getName() !== name) {
            await FirebaseService.chat.setMetaField(this.getId(), Keys.Name, name)
            this.meta.setName(name)
        }
    }

    getImageURL(): string {
        return this.meta.getImageURL()
    }

    async setImageURL(url: string): Promise<void> {
        if (!this.hasPermission(RoleType.admin())) {
            throw this.adminPermissionRequired()
        } else if (this.meta.getImageURL() !== url) {
            await FirebaseService.chat.setMetaField(this.getId(), Keys.ImageURL, url)
            this.meta.setImageURL(url)
        }
    }

    getCustomData(): IJsonObject {
        return this.meta.getData()
    }

    async setCustomData(data: IJsonObject): Promise<void> {
        if (!this.hasPermission(RoleType.admin())) {
            throw this.adminPermissionRequired()
        } else {
            await FirebaseService.chat.setMetaField(this.getId(), Paths.Data, data)
            this.meta.setData(data)
        }
    }

    getUsers(): User[] {
        return this.users
    }

    getFireStreamUsers(): Array<FireStreamUser> {
        const firestreamUsers = new Array<FireStreamUser>()
        for (const user of this.users) {
            firestreamUsers.push(FireStreamUser.fromUser(user))
        }
        return firestreamUsers
    }

    addUser(sendInvite: boolean, user: User): Promise<void>
    addUser(path: Path, dataProvider: DataProvider, user: User): Promise<void>
    async addUser(arg1: boolean | Path, arg2: User | DataProvider, arg3?: User): Promise<void> {
        if (typeof arg1 === 'boolean' && arg2 instanceof User) {
            return this.addUsers(arg1, [arg2])
        } else if (arg1 instanceof Path && !(arg2 instanceof User) && arg3 instanceof User) {
            return super.addUser(arg1, arg2, arg3)
        }
    }

    addUsers(sendInvite: boolean, users: User[]): Promise<void>
    addUsers(path: Path, dataProvider: DataProvider, users: User[]): Promise<void>
    async addUsers(arg1: boolean | Path, arg2?: User[] | DataProvider, arg3?: User[]): Promise<void> {
        if (typeof arg1 === 'boolean' && Array.isArray(arg2)) {
            await super.addUsers(Paths.chatUsersPath(this.id), User.roleTypeDataProvider(), arg2)
            if (arg1) {
                this.inviteUsers(arg2)
            }
            this.users.push(...arg2)
        }
         else if (typeof arg1 !== 'boolean' && arg2 && !Array.isArray(arg2) && arg3) {
            return super.addUsers(arg1, arg2, arg3)
        }
    }

    updateUser(user: User): Promise<void>
    updateUser(path: Path, dataProvider: DataProvider, user: User): Promise<void>
    updateUser(arg1: Path | User, arg2?: DataProvider, arg3?: User): Promise<void> {
        return super.updateUser(Paths.chatUsersPath(this.id), User.roleTypeDataProvider(), arg3 || (arg1 as User))
    }

    updateUsers(users: User[]): Promise<void>
    updateUsers(path: Path, dataProvider: DataProvider, user: User[]): Promise<void>
    updateUsers(arg1: Path | User[], arg2?: DataProvider, arg3?: User[]): Promise<void> {
        return super.updateUsers(Paths.chatUsersPath(this.id), User.roleTypeDataProvider(), arg3 || (arg1 as User[]))
    }

    removeUser(user: User): Promise<void>
    removeUser(path: Path, user: User): Promise<void>
    removeUser(arg1: User | Path, arg2?: User): Promise<void> {
        return super.removeUser(Paths.chatUsersPath(this.id), arg2 || (arg1 as User))
    }

    removeUsers(users: User[]): Promise<void>
    removeUsers(path: Path, users: User[]): Promise<void>
    removeUsers(arg1: User[] | Path, arg2?: User[]): Promise<void> {
        return super.removeUsers(Paths.chatUsersPath(this.id), arg2 || (arg1 as User[]))
    }

    async inviteUsers(users: User[]): Promise<void> {
        const promises = new Array<Promise<void>>()
        for (const user of users) {
            if (!user.isMe()) {
                promises.push(Invitation.send(user.getId(), InvitationType.chat(), this.id).then())
            }
        }
        await Promise.all(promises)
    }

    getUsersForRoleType(roleType: RoleType): User[] {
        const result = new Array<User>()
        for (const user of this.users) {
            if (user.equalsRoleType(roleType)) {
                result.push(user)
            }
        }
        return result
    }

    setRole(user: User, roleType: RoleType): Promise<void> {
        if (roleType.equals(RoleType.owner()) && !this.hasPermission(RoleType.owner())) {
            throw this.ownerPermissionRequired()
        } else if(!this.hasPermission(RoleType.admin())) {
            throw this.adminPermissionRequired()
        }
        user.setRoleType(roleType)
        return this.updateUser(user)
    }

    getRoleType(theUser: User): RoleType | undefined {
        for (const user of this.users) {
            const roleType = user.getRoleType()
            if (user.equals(theUser) && roleType) {
                return roleType
            }
        }
    }

    getAvailableRoles(user: User): RoleType[] {
        // We can't set our own role and only admins and higher can set a role
        if (!user.isMe() && this.hasPermission(RoleType.admin())) {
            // The owner can set users to any role apart from owner
            if (this.hasPermission(RoleType.owner())) {
                return RoleType.allExcluding(RoleType.owner())
            }
            // Admins can set the role type of non-admin users. They can't create or
            // destroy admins, only the owner can do that
            if (!user.equalsRoleType(RoleType.admin())) {
                return RoleType.allExcluding(RoleType.owner(), RoleType.admin())
            }
        }
        return []
    }

    getNameChangeEvents(): Observable<string> {
        return this.nameChangedEvents.asObservable()
    }

    getImageURLChangeEvents(): Observable<string> {
        return this.imageURLChangedEvents.asObservable()
    }

    getCustomDataChangedEvents(): Observable<IJsonObject> {
        return this.customDataChangedEvents.asObservable()
    }

    getUserEvents(): MultiQueueSubject<Event<User>> {
        return this.userEvents
    }

    sendMessageWithBody(body: { [key: string]: any }, newId?: Consumer<string>): Promise<void> {
        return this.send(new Message(body), newId)
    }

    sendMessageWithText(text: string, newId?: Consumer<string>): Promise<void> {
        return this.send(new TextMessage(text), newId)
    }

    sendTypingIndicator(type: TypingStateType, newId?: Consumer<string>): Promise<void> {
        return this.send(new TypingState(type), newId)
    }

    sendDeliveryReceipt(type: DeliveryReceiptType, messageId: string, newId?: Consumer<string>): Promise<void> {
        return this.send(new DeliveryReceipt(type, messageId), newId)
    }

    async send(sendable: ISendable, newId?: Consumer<string>): Promise<void> {
        if (!this.hasPermission(RoleType.member())) {
            throw this.memberPermissionRequired()
        }
        return Send.toPath(Paths.chatMessagesPath(this.id), sendable, newId)
    }

    markReceived(sendable: ISendable | string): Promise<void> {
        if (typeof sendable === 'string') {
            return this.sendDeliveryReceipt(DeliveryReceiptType.received(), sendable)
        } else {
            return this.markReceived(sendable.getId())
        }
    }

    markRead(sendable: ISendable | string): Promise<void> {
        if (typeof sendable === 'string') {
            return this.sendDeliveryReceipt(DeliveryReceiptType.read(), sendable)
        } else {
            return this.markRead(sendable.getId())
        }
    }

    public getMyRoleType(): RoleType | undefined {
        return this.getRoleType(User.expectCurrentUser())
    }

    equals(chat: any): boolean {
        if (chat instanceof Chat) {
            return this.id === chat.id
        }
        return false
    }

    protected setMeta(meta: Meta) {
        this.meta = meta
    }

    path(): Path {
        return Paths.chatPath(this.id)
    }

    metaPath(): Path {
        return Paths.chatMetaPath(this.id)
    }

    protected messagesPath(): Path {
        return Paths.chatMessagesPath(this.id)
    }

    protected ownerPermissionRequired(): Error {
        return new Error(ErrorMessage.owner_permission_required)
    }

    protected adminPermissionRequired(): Error {
        return new Error(ErrorMessage.admin_permission_required)
    }

    protected memberPermissionRequired(): Error {
        return new Error(ErrorMessage.member_permission_required)
    }

    static async create(name: string, imageURL: string, data?: IJsonObject, users?: User[]): Promise<Chat> {
        const meta = Meta.from(name, imageURL, data).addTimestamp().wrap().toData()
        const chatId = await FirebaseService.chat.add(meta)
        const chat = new Chat(chatId, undefined, new Meta(name, imageURL, data))

        // Make sure the current user is the owner
        const usersToAdd = ArrayUtils.remove(users || [], User.expectCurrentUser())
        usersToAdd.push(User.expectCurrentUser(RoleType.owner()))

        await chat.addUsers(true, usersToAdd)
        return chat
    }

    hasPermission(permission: RoleType): boolean {
        return this.getMyRoleType()?.test(permission) || false
    }

    deleteSendable(arg: Path | ISendable | string): Promise<void> {
        if (arg instanceof Path) {
            return super.deleteSendable(arg)
        } else if (typeof arg === 'string') {
            return super.deleteSendable(this.messagesPath().child(arg))
        } else {
            return this.deleteSendable(arg.getId())
        }
    }

    static from(listEvent: Event<ListData>): IChat {
        const change = listEvent.get()
        if (change.get(Keys.Date) instanceof Date) {
            return new Chat(change.getId(), change.get(Keys.Date))
        }
        return new Chat(change.getId())
    }

    mute(until?: Date): Promise<void> {
        return MuteService.mute(this.getId(), until)
    }

    unmute(): Promise<void> {
        return MuteService.unmute(this.getId())
    }

    mutedUntil(): Date | undefined {
        return MuteService.mutedUntil(this.getId())
    }

    isMuted(): boolean {
        return MuteService.isMuted(this.getId())
    }

}
