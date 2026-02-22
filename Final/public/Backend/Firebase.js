import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-auth.js";

const firebaseConfig = {
    apiKey: "AIzaSyCHWKHWe-9H_lp7r50ShIVDahTVqVkpBCE",
    authDomain: "miniprojectinf4027w.firebaseapp.com",
    projectId: "miniprojectinf4027w",
    messagingSenderId: "631063090912",
    storageBucket: "miniprojectinf4027w.appspot.com",
    appId: "1:631063090912:web:a1d0a1110461fcf96d6285",
    measurementId: "G-KCN0K6QSQB"
};

const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);
export const auth = getAuth(app);
  