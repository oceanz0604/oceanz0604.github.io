import {
  initializeApp,
  getApps
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getDatabase,
  get,
  ref,
  onValue,
  remove,
  update
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

const bookingConfig = {
    apiKey: "AIzaSyAc0Gz1Em0TUeGnKD4jQjZl5fn_FyoWCLo",
    databaseURL: "https://gaming-cafe-booking-630f9-default-rtdb.asia-southeast1.firebasedatabase.app",
    authDomain: "gaming-cafe-booking-630f9.firebaseapp.com",
    projectId: "gaming-cafe-booking-630f9",
    storageBucket: "gaming-cafe-booking-630f9.firebasestorage.app",
    messagingSenderId: "872841235480",
    appId: "1:872841235480:web:58cfe4fc38cc8a037b076d",
    measurementId: "G-PSLG65XMBT"
};

// Initialize second app if not already initialized
let secondApp = getApps().find(app => app.name === "SECOND_APP");
if (!secondApp) {
  secondApp = initializeApp(bookingConfig, "SECOND_APP");
}
const db2 = getDatabase(secondApp);

const bookingCardsEl = document.getElementById("bookingCards");

// Listen for real-time booking changes
const bookingsRef = ref(db2, "bookings");
onValue(bookingsRef, (snapshot) => {
  const data = snapshot.val();
  renderBookings(data);
});

window.fetchBookings = () => {
  const now = new Date();
  const data = get(ref(db2, "bookings")).then(snapshot => {
    const val = snapshot.val();
    renderBookings(val);
  });
};

window.downloadCSV = () => {
  const rows = [["Name", "Start", "End", "Duration", "PCs", "Price"]];
  document.querySelectorAll(".booking-card").forEach(card => {
    const cells = Array.from(card.querySelectorAll(".export-cell")).map(cell => cell.textContent);
    rows.push(cells);
  });

  const csv = rows.map(r => r.join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = `bookings_all.csv`;
  link.click();
  URL.revokeObjectURL(url);
};

function formatDate(isoString) {
  const date = new Date(isoString);
  if (isNaN(date)) return "-";
  return date.toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    hour12: true,
  });
}

function renderBookings(bookingsData) {
  const container = document.getElementById("bookingCards");
  container.innerHTML = "";

  const sortedEntries = Object.entries(bookingsData).sort(
    (a, b) => new Date(b[1].start) - new Date(a[1].start)
  );

  sortedEntries.forEach(([key, booking]) => {
    const now = new Date();
    const startTime = new Date(booking.start);
    const status = startTime > now ? "Upcoming" : "Past";
    const statusColor = status === "Upcoming" ? "text-green-400" : "text-gray-400";

    const card = document.createElement("div");
    card.className = "booking-card bg-gray-800 border border-gray-700 rounded-2xl p-5 shadow-lg hover:shadow-xl hover:scale-[1.01] transition";

    card.innerHTML = `
      <div class="flex items-center justify-between mb-2">
        <h3 class="text-lg font-semibold text-blue-400">${booking.name}</h3>
        <span class="text-xs font-medium px-2 py-1 rounded-full ${
          status === "Upcoming" ? "bg-green-600 text-white" : "bg-gray-600 text-gray-200"
        }">${status}</span>
      </div>

      <div class="grid grid-cols-1 gap-1 text-sm text-gray-300">
        <div><strong>Start:</strong> ${formatDate(booking.start)}</div>
        <div><strong>End:</strong> ${formatDate(booking.end)}</div>
        <div><strong>Duration:</strong> ${booking.duration} mins</div>
        <div><strong>Terminals:</strong> ${booking.pcs.join(", ")}</div>
        <div><strong>Price:</strong> ₹${booking.price}</div>
      </div>

      <div class="flex gap-2 mt-4">
        <button
          onclick="editBooking('${key}')"
          class="flex items-center gap-1 text-sm px-3 py-1 rounded bg-yellow-600 hover:bg-yellow-700 text-white"
        >
          <i data-lucide="edit" class="w-4 h-4"></i> Edit
        </button>
        <button
          onclick="deleteBooking('${key}')"
          class="flex items-center gap-1 text-sm px-3 py-1 rounded bg-red-600 hover:bg-red-700 text-white"
        >
          <i data-lucide="trash-2" class="w-4 h-4"></i> Delete
        </button>
      </div>
    `;
    container.appendChild(card);
  });
}

// Delete booking
window.deleteBooking = async (id) => {
  if (confirm("Are you sure you want to delete this booking?")) {
    await remove(ref(db2, `bookings/${id}`));
  }
};

// Placeholder edit (extend as needed)
window.editBooking = async (id) => {
  const newName = prompt("Enter updated name:");
  if (newName?.trim()) {
    await update(ref(db2, `bookings/${id}`), { name: newName });
  }
};
