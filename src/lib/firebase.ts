import { initializeApp, FirebaseApp } from 'firebase/app';
import { getFirestore, Firestore } from 'firebase/firestore';

// ============================================
// PASTE YOUR FIREBASE CONFIG HERE
// Get it from Firebase Console > Project Settings > Your apps > Config
// ============================================
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

let app: FirebaseApp | null = null;
let db: Firestore | null = null;
let initError: string | null = null;

try {
  // Only initialize if config looks valid
  if (firebaseConfig.projectId && !firebaseConfig.projectId.includes('YOUR_')) {
    app = initializeApp(firebaseConfig);
    db = getFirestore(app);
  } else {
    initError = 'Firebase config not set. Edit src/lib/firebase.ts with your config.';
    console.warn(initError);
  }
} catch (error) {
  initError = error instanceof Error ? error.message : 'Failed to initialize Firebase';
  console.error('Firebase initialization error:', error);
}

export { db, initError };
