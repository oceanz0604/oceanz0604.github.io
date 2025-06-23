const apiURL = 'https://script.google.com/macros/s/AKfycbyBxN7KdwYj0pgR0x4um0BfRtJ4r9-Pg6j2Tb5MUUT_qkTfftYdMoqSHD66bANn8fNg/exec'; // Replace this

function fetchBookings() {
  fetch(apiURL)
    .then(response => response.json())
    .then(data => {
      const tbody = document.querySelector("#bookingsTable tbody");
      const filterDate = document.getElementById("filterDate").value;
      tbody.innerHTML = "";

      data.filter(b => {
        if (!filterDate) return true;
        return new Date(b.start).toISOString().slice(0, 10) === filterDate;
      }).forEach(row => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${row.name}</td>
          <td>${row.pc}</td>
          <td>${new Date(row.start).toLocaleString()}</td>
          <td>${new Date(row.end).toLocaleString()}</td>
          <td>${row.duration}</td>
          <td>₹${row.price}</td>`;
        tbody.appendChild(tr);
      });
    })
    .catch(error => alert("Error loading bookings: " + error));
}

function downloadCSV() {
  const rows = Array.from(document.querySelectorAll("table tr"));
  const csv = rows.map(row => 
    Array.from(row.children).map(cell => `"${cell.innerText}"`).join(",")
  ).join("\n");

  const blob = new Blob([csv], { type: "text/csv" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "bookings.csv";
  link.click();
}

window.onload = fetchBookings;
