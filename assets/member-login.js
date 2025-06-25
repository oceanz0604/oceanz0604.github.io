// Firebase config for fdb-dataset (SECOND APP)
const secondAppConfig = {
  apiKey: "AIzaSyCaC558bQ7mhYlhjmthvZZX9SBVvNe6wYg",
  authDomain: "fdb-dataset.firebaseapp.com",
  databaseURL: "https://fdb-dataset-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "fdb-dataset",
  storageBucket: "fdb-dataset.appspot.com",
  messagingSenderId: "497229278574",
  appId: "1:497229278574:web:c8f127aad76b8ed004657f",
  measurementId: "G-4FLTSGLWBR"
};

// Initialize Firebase
const secondApp = firebase.initializeApp(secondAppConfig, "SECOND_APP");
const secondDb = secondApp.database();

// Login handler
document.getElementById("memberLoginForm").addEventListener("submit", function (e) {
  e.preventDefault();

  const username = document.getElementById("username").value.trim().toLowerCase();
  const password = document.getElementById("password").value.trim();
  const errorDiv = document.getElementById("login-error");

  if (!username || !password) {
    errorDiv.textContent = "⚠ Please enter both username and password.";
    errorDiv.classList.remove("hidden");
    return;
  }

  secondDb.ref("fdb/MEMBERS").once("value").then(snapshot => {
    const members = snapshot.val() || {};
    const match = Object.values(members).find(m =>
      m.USERNAME?.toLowerCase() === username &&
      m.PASSWORD === password
    );

    if (match) {
      sessionStorage.setItem("member", JSON.stringify(match));
      window.location.href = "members.html";
    } else {
      errorDiv.textContent = "❌ Invalid credentials. Please try again.";
      errorDiv.classList.remove("hidden");
    }
  }).catch(err => {
    console.error("Login failed:", err);
    errorDiv.textContent = "🔥 Error connecting to database.";
    errorDiv.classList.remove("hidden");
  });
});
