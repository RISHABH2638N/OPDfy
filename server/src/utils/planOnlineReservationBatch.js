function conflict(message, code = "ONLINE_RESERVATION_LIMIT") {
  return Object.assign(new Error(message), { status: 409, code });
}

export function planBatch({ entries, alreadyReserved, used, limit, doctorName }) {
  const bookedPatients = new Set(alreadyReserved.map((r) => String(r.patient)));
  const result = Array(entries.length);
  const selected = [];
  const fullMessage = `Online reservations for Dr. ${doctorName} are full today. Walk-in patients can still check in at reception subject to clinic availability.`;
  let available = Math.max(0, limit - used);
  for (let i = 0; i < entries.length; i++) {
    const patientId = String(entries[i].patient._id);
    if (bookedPatients.has(patientId)) {
      result[i] = { error: conflict("You already have an online reservation today. Check in at reception when you arrive.", "ALREADY_RESERVED") };
    } else if (available <= 0) {
      result[i] = { error: conflict(fullMessage) };
    } else {
      bookedPatients.add(patientId);
      selected.push(i);
      available--;
    }
  }
  return { outcomes: result, selected };
}

