// lib/firebaseClient.ts
import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyD4Tunn8C_kGmjzh5lKJ7uT-u7DEqsDdrc",
  authDomain: "group-money-tracker.firebaseapp.com",
  projectId: "group-money-tracker",
  storageBucket: "group-money-tracker.firebasestorage.app",
  messagingSenderId: "103174151977",
  appId: "1:103174151977:web:5850d35a04f05b3d7be138",
};

const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();

export const auth = getAuth(app);
export const db = getFirestore(app);

