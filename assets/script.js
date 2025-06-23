const scriptURL = 'https://script.google.com/macros/s/AKfycbyBxN7KdwYj0pgR0x4um0BfRtJ4r9-Pg6j2Tb5MUUT_qkTfftYdMoqSHD66bANn8fNg/exec'; // Replace this
const pricePerMinute = 40 / 60;
const priceInfo = document.getElementById('priceInfo');

function calculatePrice() {
  const start = new Date(document.getElementById('startTime').value);
  const end = new Date(document.getElementById('endTime').value);
  const minutes = Math.abs((end - start) / (1000 * 60));
  const pcCount = document.getElementById('pcNumber').selectedOptions.length;
  const price = Math.ceil(minutes) * pricePerMinute * pcCount;
  if (!isNaN(price)) priceInfo.innerText = `💰 Total Price: ₹${price} for ${pcCount} PC(s)`;
}

document.getElementById('startTime').addEventListener('change', calculatePrice);
document.getElementById('endTime').addEventListener('change', calculatePrice);
document.getElementById('pcNumber').addEventListener('change', calculatePrice);

document.getElementById('bookingForm').addEventListener('submit', function (e) {
  e.preventDefault();
  const name = document.getElementById('userName').value;
  const email = document.getElementById('email').value;
  const selectedOptions = Array.from(document.getElementById('pcNumber').selectedOptions);
  const pcs = selectedOptions.map(option => option.value);
  const start = new Date(document.getElementById('startTime').value);
  const end = new Date(document.getElementById('endTime').value);
  const duration = Math.abs((end - start) / (1000 * 60));
  const price = Math.ceil(duration * pricePerMinute * pcs.length);

  if (start >= end) {
    alert('End time must be after start time!');
    return;
  }

  const data = { name, email, pcs, start: start.toISOString(), end: end.toISOString(), duration, price };

  fetch(scriptURL, {
    method: 'POST',
    body: JSON.stringify(data),
    headers: { 'Content-Type': 'application/json' }
  })
    .then(response => response.json())
    .then(res => {
      if (res.status === "error") {
        alert("❌ " + res.message);
      } else {
        document.getElementById('bookingResult').innerHTML =
          `<strong>✅ Booking Confirmed!</strong><br>Name: ${name}<br>PCs: ${pcs.join(", ")}<br>Start: ${start}<br>End: ${end}<br>Duration: ${duration} mins<br>Total: ₹${price}`;
        document.getElementById('bookingForm').reset();
        priceInfo.innerText = "💰 Total Price: ₹0";
      }
    })
    .catch(error => alert('Error saving booking: ' + error));
});
