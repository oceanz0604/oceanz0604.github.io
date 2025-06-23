const scriptURL = 'https://script.google.com/macros/s/AKfycbxnn3V5ImVKI4NWhH1toKAJiF7IdsnhcX32HCYarnJOJcAqGqjNNWfr-ufnpry-x-G-/exec';

document.getElementById('bookingForm').addEventListener('submit', function (e) {
  e.preventDefault();

  const name = document.getElementById('userName').value;
  const pc = document.getElementById('pcNumber').value;
  const start = new Date(document.getElementById('startTime').value);
  const end = new Date(document.getElementById('endTime').value);
  const duration = Math.abs((end - start) / (1000 * 60));

  if (start >= end) {
    alert('End time must be after start time!');
    return;
  }

  const data = {
    name,
    pc,
    start: start.toLocaleString(),
    end: end.toLocaleString(),
    duration
  };

  fetch(scriptURL, {
    method: 'POST',
    body: JSON.stringify(data),
    headers: { 'Content-Type': 'application/json' }
  })
  .then(response => response.text())
  .then(res => {
    document.getElementById('bookingResult').innerHTML =
      `<strong>✅ Booking Saved!</strong><br>Name: ${name}<br>PC: ${pc}<br>Start: ${data.start}<br>End: ${data.end}<br>Duration: ${duration} mins`;
    document.getElementById('bookingForm').reset();
  })
  .catch(error => alert('Error saving booking: ' + error));
});
