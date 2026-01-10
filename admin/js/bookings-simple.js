/**
 * OceanZ Gaming Cafe - Simple Admin Bookings View
 */

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
        cards.push(`
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
        `);
      }
    });

    cardsContainer.innerHTML = cards.length > 0 ? cards.join("") : "<p>No bookings on this date.</p>";
  });
}

function downloadCSV() {
  // Alias for PDF export
  downloadPDF();
}

function downloadPDF() {
  const cards = document.querySelectorAll(".booking-card");
  const rows = [];
  let totalRevenue = 0;

  cards.forEach(card => {
    const name = card.querySelector("h3").textContent;
    const details = card.querySelectorAll(".booking-details div");
    const values = Array.from(details).map(d => d.textContent.split(":").slice(1).join(":").trim());
    rows.push([name, ...values]);
    
    // Extract price
    const priceStr = values[4] || "0";
    const price = parseFloat(priceStr.replace('₹', '').replace(',', '')) || 0;
    totalRevenue += price;
  });

  if (rows.length === 0) {
    alert("No bookings to export");
    return;
  }

  // Create PDF
  const doc = PDFExport.createStyledPDF();
  const filterDate = document.getElementById("filterDate").value;
  const dateStr = filterDate || new Date().toLocaleDateString('en-IN', { 
    timeZone: 'Asia/Kolkata',
    day: 'numeric', 
    month: 'long', 
    year: 'numeric' 
  });
  let y = PDFExport.addPDFHeader(doc, 'Bookings Report', dateStr);
  
  // Summary stats
  y = PDFExport.addPDFSummary(doc, [
    { label: 'Total Bookings', value: String(rows.length), color: 'neonCyan' },
    { label: 'Total Revenue', value: `Rs.${totalRevenue}`, color: 'neonGreen' },
  ], y);
  
  // Table
  PDFExport.addPDFTable(doc, 
    ['Name', 'PC', 'Start', 'End', 'Duration', 'Price'],
    rows,
    y,
    { 
      columnStyles: {
        5: { halign: 'right' }
      }
    }
  );
  
  const filename = filterDate ? `bookings_${filterDate}` : `bookings_${new Date().toISOString().slice(0, 10)}`;
  PDFExport.savePDF(doc, filename);
}

