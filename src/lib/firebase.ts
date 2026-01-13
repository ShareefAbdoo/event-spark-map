import { initializeApp, getApps } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getDatabase } from "firebase/database";

const firebaseConfig = {
apiKey: "AIzaSyANWQVxTJCoz0AVz1djCaVfvsRkmFEGMUc",
authDomain: "motorcyclesaver.firebaseapp.com",
databaseURL: "https://motorcyclesaver-default-rtdb.firebaseio.com",
projectId: "motorcyclesaver",
storageBucket: "motorcyclesaver.firebasestorage.app",
messagingSenderId: "952927970542",
appId: "1:952927970542:web:1139f1c9658675ba34bfff",
measurementId: "G-VK606982DH",
};

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);

export const db = getFirestore(app);     // optional (fine to keep)
export const rtdb = getDatabase(app);    // ✅ this is what HotspotMap uses
export const initError: string | null = null;
