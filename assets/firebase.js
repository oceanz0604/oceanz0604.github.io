
// Replace these values with your Firebase config
const firebaseConfig = {
    apiKey: "AIzaSyAc0Gz1Em0TUeGnKD4jQjZl5fn_FyoWCLo",
    databaseURL: "https://gaming-cafe-booking-630f9-default-rtdb.asia-southeast1.firebasedatabase.app",
    authDomain: "gaming-cafe-booking-630f9.firebaseapp.com",
    projectId: "gaming-cafe-booking-630f9",
    storageBucket: "gaming-cafe-booking-630f9.firebasestorage.app",
    messagingSenderId: "872841235480",
    appId: "1:872841235480:web:58cfe4fc38cc8a037b076d",
    measurementId: "G-PSLG65XMBT"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();

const form = document.getElementById("bookingForm");
const resultDiv = document.getElementById("bookingResult");
const priceDisplay = document.getElementById("priceInfo");

document.querySelectorAll('.pc-checkboxes input[type="checkbox"]').forEach(checkbox => {
  checkbox.addEventListener('change', () => {
    checkbox.parentElement.classList.toggle('selected', checkbox.checked);
  });
});

form.addEventListener("submit", function(e) {
  e.preventDefault();

  const name = document.getElementById("userName").value.trim();
  const startValue = document.getElementById("startTime").value;
  const endValue = document.getElementById("endTime").value;

  const selectedPCs = Array.from(document.querySelectorAll(".pc-option:checked")).map(cb => cb.value);
  if (selectedPCs.length === 0) {
    alert("Please select at least one PC.");
    return;
  }

  const now = new Date();
  const today = now.toISOString().split("T")[0];
  const startTime = new Date(today + "T" + startValue);
  const endTime = new Date(today + "T" + endValue);

  const duration = (endTime - startTime) / (1000 * 60); // in minutes
  if (duration < 60) {
    alert("Booking should be done for at least 1 hour");
    return;
  }

  const price = duration * selectedPCs.length * 40 / 60;

  const bookingData = {
    name,
    pcs: selectedPCs,
    start: startTime.toISOString(),
    end: endTime.toISOString(),
    duration,
    price
  };

  db.ref("bookings").once("value", snapshot => {
    const bookings = snapshot.val();
    let conflict = false;

    if (bookings) {
      Object.values(bookings).forEach(b => {
        b.pcs.forEach(pc => {
          if (selectedPCs.includes(pc)) {
            const bookedStart = new Date(b.start);
            const bookedEnd = new Date(b.end);
            if (
              (startTime >= bookedStart && startTime < bookedEnd) ||
              (endTime > bookedStart && endTime <= bookedEnd) ||
              (startTime <= bookedStart && endTime >= bookedEnd)
            ) {
              conflict = true;
            }
          }
        });
      });
    }

    if (conflict) {
      resultDiv.innerHTML = "<p style='color:red;'>⚠ One or more PCs are already booked for the selected time.</p>";
    } else {
      const newRef = db.ref("bookings").push();
      newRef.set(bookingData, () => {
        resultDiv.innerHTML = "<p style='color:green;'>✅ Booking successful!</p>";
        form.reset();
        updatePriceDisplay();
      });
    }
  });
});

// Auto update price
function updatePriceDisplay() {
  const selectedPCs = Array.from(document.querySelectorAll(".pc-option:checked")).length;
  const startValue = document.getElementById("startTime").value;
  const endValue = document.getElementById("endTime").value;
  if (!startValue || !endValue || selectedPCs === 0) {
    priceDisplay.textContent = "💰 Total Price: ₹0";
    return;
  }

  const now = new Date();
  const today = now.toISOString().split("T")[0];
  const startTime = new Date(today + "T" + startValue);
  const endTime = new Date(today + "T" + endValue);
  const duration = (endTime - startTime) / (1000 * 60);
  const price = duration * selectedPCs;
  priceDisplay.textContent = `💰 Total Price: ₹${price}`;
}

document.getElementById("startTime").addEventListener("input", updatePriceDisplay);
document.getElementById("endTime").addEventListener("input", updatePriceDisplay);
document.querySelectorAll(".pc-option").forEach(cb => {
  cb.addEventListener("change", updatePriceDisplay);
});
