import { FireStreamStore } from '../../firestream-store'
import { Keys } from './keys'
import { Path } from './path'

export class Paths extends Keys {

    static root(): Path {
        return new Path([FireStreamStore.config.getRoot(), FireStreamStore.config.getSandbox()])
    }

    static usersPath(): Path {
        return this.root().child(this.Users);
    }

    static userPath(uid?: string): Path {
        return this.usersPath().child(uid || this.currentUserId())
    }

    static messagesPath(uid?: string): Path {
        return this.userPath(uid || this.currentUserId()).child(this.Messages)
    }

    static userChatsPath(): Path {
        return this.userPath(this.currentUserId()).child(Keys.Chats)
    }

    static userMutedPath(): Path {
        return this.userPath(this.currentUserId()).child(Keys.Muted)
    }

    static userGroupChatPath(chatId: string): Path {
        return this.userChatsPath().child(chatId)
    }

    static messagePath(messageId: string): Path
    static messagePath(uid: string, messageId: string): Path
    static messagePath(arg1: string, arg2?: string): Path {
        if (arg2) {
            return this.messagesPath(arg1).child(arg2)
        } else {
            return this.messagePath(this.currentUserId(), arg1)
        }
    }

    protected static currentUserId(): string {
        return FireStreamStore.expectUserId()
    }

    static contactsPath(): Path {
        return this.userPath().child(this.Contacts)
    }

    static blockedPath(): Path {
        return this.userPath().child(this.Blocked)
    }

    static chatsPath(): Path {
        return this.root().child(this.Chats)
    }

    static chatPath(chatId: string): Path {
        return this.chatsPath().child(chatId)
    }

    static chatMetaPath(chatId: string): Path {
        return this.chatsPath().child(chatId).child(this.Meta)
    }

    static chatMessagesPath(chatId: string): Path {
        return this.chatPath(chatId).child(this.Messages)
    }

    static chatUsersPath(chatId: string): Path {
        return this.chatPath(chatId).child(this.Users)
    }

}
