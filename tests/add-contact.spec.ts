import { IFireStream } from '../src'
import { User } from '../src/chat'
import { ContactType } from '../src/types'

export const addContactTest = (FS: IFireStream) => async (testUser: User) => {
    await FS.addContact(testUser, ContactType.contact())

    const contacts = FS.getContacts()
    if (contacts.length !== 1) {
        throw new Error('contacts size must be 1')
    } else if (!contacts[0].equals(testUser)) {
        throw new Error('correct user not added to contacts')
    }
}
