const express = require("express");
const nodemailer = require("nodemailer");
const cors = require("cors");
require("dotenv").config();

const app = express();

// CORS configuration to allow requests from Webflow site
const corsOptions = {
  origin: [
    "https://biaw-stage-3d0019b2f20edef3124873f20de2.webflow.io", // Replace with your Webflow domain
    "https://biaw-stage-3d0019b2f20edef3124873f20de2.webflow.io/signup" // Add other domains if needed
  ],
  optionsSuccessStatus: 200,
};
app.use(cors(corsOptions));

// Middleware to parse JSON and URL-encoded bodies
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Root route for base URL testing
app.get("/", (req, res) => {
  res.send("Server is running and ready to accept requests.");
});

// Nodemailer transporter configuration
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER, // Your Gmail email
    pass: process.env.EMAIL_PASSWORD, // Your Gmail app password
  },
});

// Function to generate a 6-digit OTP
const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Endpoint to handle form submission and send OTP email
app.post("/send-otp", async (req, res) => {
  console.log("Form data received:", req.body); // Debugging log
  const { firstName, lastName, email } = req.body;

  // Validate the presence of required fields
  if (!email) {
    return res.status(400).json({ error: "Email is required" });
  }

  const otp = generateOTP();
  const mailOptions = {
    from: `"Your Service" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: "Your OTP Code",
    text: `Hello ${firstName || "User"} ${lastName || ""},\n\nYour OTP code is: ${otp}\n\nPlease use this code to complete your verification.`,
  };

  try {
    // Send email and handle response
    await transporter.sendMail(mailOptions);
    console.log("OTP email sent successfully to:", email);
    res.status(200).json({ message: "OTP sent successfully!" });
  } catch (error) {
    console.error("Error sending OTP email:", error);
    res.status(500).json({ error: "Failed to send OTP", details: error.message });
  }
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
