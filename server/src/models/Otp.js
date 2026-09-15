import mongoose from "mongoose";


import tenantScopedPlugin from "./tenantScopedPlugin.js";
/* =========================================================
   OTP SCHEMA
========================================================= */

const otpSchema =
  new mongoose.Schema(
    {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
      /* ---------------------------------------------
         Email associated with OTP
      --------------------------------------------- */

      email: {
        type: String,

        required: true,

        lowercase: true,

        trim: true,

        index: true,
      },


      /* ---------------------------------------------
         SHA-256 hashed OTP

         We NEVER store the actual OTP.
      --------------------------------------------- */

      otpHash: {
        type: String,

        required: true,

        trim: true,
      },


      /* ---------------------------------------------
         OTP expiration time
      --------------------------------------------- */

      expiresAt: {
        type: Date,

        required: true,

        // index: true,
      },


      /* ---------------------------------------------
         Failed verification attempts
      --------------------------------------------- */

      attempts: {
        type: Number,

        default: 0,

        min: 0,
      },
    },

    {
      timestamps: true,
    }
  );


/* =========================================================
   TTL INDEX

   MongoDB automatically removes expired OTP records.
========================================================= */

otpSchema.index(
  {
    expiresAt: 1,
  },
  {
    expireAfterSeconds: 0,
  }
);


/* =========================================================
   MODEL
========================================================= */

otpSchema.plugin(tenantScopedPlugin);

const Otp =
  mongoose.model(
    "Otp",
    otpSchema
  );

export default Otp;
