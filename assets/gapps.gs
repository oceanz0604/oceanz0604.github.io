function doPost(e) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const data = JSON.parse(e.postData.contents);

  const name = data.name;
  const email = data.email;
  const pcs = data.pcs;
  const start = new Date(data.start);
  const end = new Date(data.end);
  const duration = data.duration;
  const price = data.price;

  const existing = sheet.getDataRange().getValues();
  const conflicts = [];

  for (let i = 1; i < existing.length; i++) {
    const bookedPC = existing[i][2];
    const existingStart = new Date(existing[i][3]);
    const existingEnd = new Date(existing[i][4]);

    pcs.forEach(pc => {
      const overlap =
        bookedPC === pc &&
        ((start >= existingStart && start < existingEnd) ||
         (end > existingStart && end <= existingEnd) ||
         (start <= existingStart && end >= existingEnd));

      if (overlap && !conflicts.includes(pc)) {
        conflicts.push(pc);
      }
    });
  }

  if (conflicts.length > 0) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: "error", message: "⚠ PCs already booked: " + conflicts.join(", ") }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // Save each PC as a separate row
  pcs.forEach(pc => {
    sheet.appendRow([name, email, pc, start.toString(), end.toString(), duration, price / pcs.length]);
  });

  // Email confirmation
  MailApp.sendEmail({
    to: email,
    subject: "🎮 Gaming Café Booking Confirmed!",
    htmlBody: `
      Hi ${name},<br><br>
      Your booking for PC(s) <strong>${pcs.join(", ")}</strong> is confirmed.<br><br>
      <b>Start:</b> ${start}<br>
      <b>End:</b> ${end}<br>
      <b>Duration:</b> ${duration} mins<br>
      <b>Total:</b> ₹${price}<br><br>
      Thanks for choosing us!`
  });

  return ContentService
    .createTextOutput(JSON.stringify({ status: "success", message: "Booking confirmed!" }))
    .setMimeType(ContentService.MimeType.JSON);
}
