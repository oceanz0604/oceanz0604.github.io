$(document).ready(function () {
  const scriptURL = 'https://script.google.com/macros/s/AKfycbw2ntVhmvwpkRrTVal9CRxR-2yfXm5vRCUu5huY40VQO5t-N2bfZv6HRh-5kObmYI6J/exec'; // 🔁 Replace with your script URL
  const pricePerMinute = 40/60;

  function getTodayTime(timeStr) {
  const [hours, minutes] = timeStr.split(":").map(Number);
  const now = new Date();
  now.setHours(hours, minutes, 0, 0);
  return new Date(now);
  }

  function calculatePrice() {
    const start = getTodayTime($('#startTime').val());
    const end = getTodayTime($('#endTime').val());
    const pcCount = $('.pc-option:checked').length;
    const minutes = Math.abs((end - start) / (1000 * 60));
    const price = Math.ceil(minutes) * pricePerMinute * pcCount;
    if (!isNaN(price)) $('#priceInfo').text(`💰 Total Price: ₹${price} for ${pcCount} PC(s)`);
  }

  $('.pc-option').change(calculatePrice);
  $('#startTime, #endTime').change(calculatePrice);

  $('#bookingForm').submit(function (e) {
    e.preventDefault();
    const name = $('#userName').val();
    const email = $('#email').val();
    const pcs = $('.pc-option:checked').map(function () { return this.value; }).get();
    const start = getTodayTime($('#startTime').val());
    const end = getTodayTime($('#endTime').val());
    const duration = Math.abs((end - start) / (1000 * 60));
    const price = Math.ceil(duration * pricePerMinute * pcs.length);

    if (start >= end) return alert("End time must be after start time!");
    if (pcs.length === 0) return alert("Please select at least one PC!");

    $.ajax({
      url: scriptURL,
      method: "POST",
      contentType: "application/json",
      data: JSON.stringify({ name, email, pcs, start: start.toISOString(), end: end.toISOString(), duration, price }),
      success: function (res) {
        const result = typeof res === "string" ? JSON.parse(res) : res;
        if (result.status === "error") {
          alert("❌ " + result.message);
        } else {
          $('#bookingResult').html(`<strong>✅ Booking Confirmed!</strong><br>Name: ${name}<br>PCs: ${pcs.join(", ")}<br>Start: ${start}<br>End: ${end}<br>Duration: ${duration} mins<br>Total: ₹${price}`);
          $('#bookingForm')[0].reset();
          $('#priceInfo').text("💰 Total Price: ₹0");
        }
      },
      error: function () { alert("Error saving booking."); }
    });
  });
});
