import Feedback from "../models/Feedback.js";
import { publicDoctorVerification } from "../utils/legalVerification.js";

// Feedback creation already requires an owned, completed consultation and is
// unique per consultation. The model's aggregation hook enforces tenant scope.
export async function withDoctorRatings(doctors) {
  if (!doctors.length) return [];
  const summaries = await Feedback.aggregate([
    { $match: { doctor: { $in: doctors.map((doctor) => doctor._id) }, rating: { $gte: 1, $lte: 5 } } },
    { $group: { _id: "$doctor", averageRating: { $avg: "$rating" }, reviewCount: { $sum: 1 } } },
  ]);
  const byDoctor = new Map(summaries.map((summary) => [String(summary._id), summary]));
  return doctors.map((doctor) => {
    const summary = byDoctor.get(String(doctor._id));
    return { ...doctor, professionalVerification: publicDoctorVerification(doctor.professionalVerification || {}), ratingSummary: {
      averageRating: summary ? Number(summary.averageRating.toFixed(1)) : null,
      reviewCount: summary?.reviewCount || 0,
    } };
  });
}
