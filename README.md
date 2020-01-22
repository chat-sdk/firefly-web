# FireStream JS

## Initializing FireStream with Firebase App
```js
import * as firebase from 'firebase/app'
import 'firebase/auth'
import 'firebase/database' // only required using the Realtime Database
import 'firebase/firestore' // only required using the Firestore
import { Fire } from 'firestream'

const app = firebase.initializeApp({ /* firebaseConfig */ })

Fire.Stream.initialize(app)
```
