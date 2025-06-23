const apiURL = 'https://script.google.com/macros/s/AKfycbxnn3V5ImVKI4NWhH1toKAJiF7IdsnhcX32HCYarnJOJcAqGqjNNWfr-ufnpry-x-G-/exec';

function fetchBookings() {
  fetch(apiURL)
    .then(response => response.json())
    .then(data => {
      const tbody = document.querySelector("#bookingsTable tbody");
      tbody.innerHTML = "";

      data.forEach(row => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${row.name}</td>
          <td>${row.pc}</td>
          <td>${row.start}</td>
          <td>${row.end}</td>
          <td>${row.duration}</td>
        `;
        tbody.appendChild(tr);
      });
    })
    .catch(error => {
      alert("Error fetching bookings: " + error);
    });
}

window.onload = fetchBookings;
