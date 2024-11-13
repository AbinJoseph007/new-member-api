const express = require("express");
const nodemailer = require("nodemailer");
const app = express();

app.use(express.json()); // Parse JSON bodies for POST requests
app.use(express.urlencoded({ extended: true })); // Parse URL-encoded bodies

// Configure Nodemailer
const transporter = nodemailer.createTransport({
    service: "gmail",
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    auth: {
        user: "abinjosephonline.in@gmail.com",
        pass: "hbme mhff xgob zzyj",
    },
});

// Function to generate a 6-digit OTP
const generateOTP = () => {
    return Math.floor(100000 + Math.random() * 900000).toString();
};

// Endpoint to handle form submission and send OTP
app.post("/send-otp", async (req, res) => {
    const { firstName, lastName, email } = req.body;

    if (!email) {
        return res.status(400).json({ error: "Email is required" });
    }

    const otp = generateOTP();
    const mailOptions = {
        from: '"Your Service" <your-email@gmail.com>',
        to: email, // Send OTP to the dynamic email address from the form
        subject: "Your OTP Code",
        text: `Hello ${firstName} ${lastName},\n\nYour OTP code is: ${otp}\n\nPlease use this code to complete your verification.`,
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log("OTP email sent successfully to:", email);
        res.status(200).json({ message: "OTP sent successfully!" });
    } catch (error) {
        console.error("Error sending OTP email:", error);
        res.status(500).json({ error: "Failed to send OTP" });
    }
});

// Start the server
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
