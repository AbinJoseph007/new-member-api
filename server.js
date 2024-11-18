const express = require("express");
const nodemailer = require("nodemailer");
const cors = require("cors");
require("dotenv").config();
const Airtable = require("airtable");

const app = express();

const corsOptions = {
  origin: [
    "https://biaw-stage-3d0019b2f20edef3124873f20de2.webflow.io", 
    "https://biaw-stage-3d0019b2f20edef3124873f20de2.webflow.io/signup"
  ],
  optionsSuccessStatus: 200,
};
app.use(cors(corsOptions));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/", (req, res) => {
    res.send("Server is running and ready to accept requests.");
  });

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER, 
    pass: process.env.EMAIL_PASSWORD, 
  },
});


const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);


const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

app.post("/send-otp", async (req, res) => {
  console.log("Form data received:", req.body);
  const { firstName, LastName, company, email, pin } = req.body; 

  
  const membershipCompanyId = pin || null;

  const otp = generateOTP();

  try {
    
    const records = await base('Member and Non-member sign up details')
      .select({
        filterByFormula: `{Email} = "${email}"`, 
      })
      .firstPage();

    if (records.length > 0) {
      return res.status(400).json({ error: "This email is already registered. Please use a different email." });
    }
    const mailOptions = {
      from: `"Your Service" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "Your OTP Code",
      text: `Hello ${firstName || "User"} ${LastName || ""},\n\nYour OTP code is: ${otp}\n\nPlease use this code to complete your verification.`,
      html: `<p>Hello ${firstName || "User"} ${LastName || ""},</p><p>Your OTP code is: <strong>${otp}</strong></p><p>Please use this code to complete your verification.</p>`,
    };

    await transporter.sendMail(mailOptions);
    console.log("OTP email sent successfully to:", email);
    await base('Member and Non-member sign up details').create([
      {
        fields: {
          "First Name": firstName,
          "Last Name": LastName, 
          "Email": email, 
          "Company": company,
          "Membership Company ID": membershipCompanyId,
          "Verification Code": otp,
        },
      },
    ]);

    console.log("Data added to Airtable");

    res.status(200).json({ message: "OTP sent successfully and data added to Airtable", otp });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "Failed to send OTP or add data to Airtable", details: error.message });
  }
});

app.post("/verify-otp", async (req, res) => {
  const { email, otp } = req.body;

  try {
    const records = await base('Member and Non-member sign up details')
      .select({
        filterByFormula: `AND({Email} = '${email}', {Verification Code} = '${otp}')`
      })
      .firstPage();
    if (records.length === 0) {
      return res.status(400).json({ error: "Invalid email or OTP." });
    }
    return res.status(200).json({ message: "OTP verified successfully." });
  } catch (error) {
    console.error("Error verifying OTP:", error);
    res.status(500).json({ error: "Server error while verifying OTP." });
  }
});


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
