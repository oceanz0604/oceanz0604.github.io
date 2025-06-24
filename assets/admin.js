// Replace with your actual Firebase config
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

const cardsContainer = document.getElementById("bookingCards");

window.onload = fetchBookings;

function fetchBookings() {
  const filterDate = document.getElementById("filterDate").value;
  cardsContainer.innerHTML = "<p>Loading bookings...</p>";

  db.ref("bookings").once("value", snapshot => {
    const data = snapshot.val();
    cardsContainer.innerHTML = "";

    if (!data) {
      cardsContainer.innerHTML = "<p>No bookings found.</p>";
      return;
    }

    const cards = [];

    Object.values(data).forEach(b => {
      const start = new Date(b.start);
      const end = new Date(b.end);
      const bookingDate = start.toISOString().split("T")[0];

      if (!filterDate || filterDate === bookingDate) {
        const card = `
          <div class="booking-card">
            <h3>${b.name}</h3>
            <div class="booking-details">
              <div><strong>PC:</strong> ${b.pcs.join(", ")}</div>
              <div><strong>Start:</strong> ${start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
              <div><strong>End:</strong> ${end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
              <div><strong>Duration:</strong> ${b.duration} min</div>
              <div><strong>Price:</strong> ₹${b.price}</div>
            </div>
          </div>
        `;
        cards.push(card);
      }
    });

    cardsContainer.innerHTML = cards.length > 0
      ? cards.join("")
      : "<p>No bookings on this date.</p>";
  });
}

function downloadCSV() {
  const rows = [["Name", "PC", "Start Time", "End Time", "Duration", "Price"]];
  const cards = document.querySelectorAll(".booking-card");

  cards.forEach(card => {
    const name = card.querySelector("h3").textContent;
    const pcs = card.querySelector("div strong:nth-of-type(1)").nextSibling.textContent.trim();
    const start = card.querySelector("div strong:nth-of-type(2)").nextSibling.textContent.trim();
    const end = card.querySelector("div strong:nth-of-type(3)").nextSibling.textContent.trim();
    const duration = card.querySelector("div strong:nth-of-type(4)").nextSibling.textContent.trim();
    const price = card.querySelector("div strong:nth-of-type(5)").nextSibling.textContent.trim();

    rows.push([name, pcs, start, end, duration, price]);
  });

  const csvContent = "data:text/csv;charset=utf-8," + rows.map(e => e.join(",")).join("\n");
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", "bookings.csv");
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
