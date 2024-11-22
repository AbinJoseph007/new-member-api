const express = require("express");
const nodemailer = require("nodemailer");
const cors = require("cors");
require("dotenv").config();
const Airtable = require("airtable");
const axios = require("axios");

const app = express();

// CORS configuration
// CORS configuration
const allowedOrigins = [
  "https://biaw-stage-api.webflow.io",
];
app.use(
  cors({
    origin: allowedOrigins,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

// Middleware for parsing JSON and URL-encoded data
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// Root route
app.get("/", (req, res) => {
  res.send("Server is running and ready to accept requests.");
});

// Nodemailer transporter setup
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD,
  },
});

// Airtable setup
const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);

// Generate a 6-digit OTP
const generateOTP = () => Math.floor(100000 + Math.random() * 900000).toString();

// Check if Company ID exists in NAHB Data
const checkCompanyId = async (companyId) => {
  try {
    const records = await base("NAHB Data")
      .select({
        filterByFormula: `{Company ID} = "${companyId}"`,
      })
      .firstPage();

    if (records.length === 0) return null;
    return records[0].fields["Member Type"];
    
  } catch (error) {
    console.error("Error checking Company ID:", error);
    throw new Error("Failed to verify Company ID.");
  }
};

const createMemberInMemberstack = async (memberData) => {
  const url = "https://admin.memberstack.com/members";
  const headers = {
    "X-API-KEY": process.env.MEMBERSTACK_API_KEY, // Use the correct API key header
    "Content-Type": "application/json",
  };

  try {
    const response = await axios.post(url, memberData, { headers });

    console.log("Memberstack Response:", response.data);

    return response.data; // Return the response from Memberstack
  } catch (error) {
    console.error("Error creating member in Memberstack:");
    console.error("Response Data:", error.response?.data || "No response data");
    console.error("Error Message:", error.message);

    // Re-throw error with additional details for better debugging
    throw new Error(
      `Failed to create Memberstack member. Status: ${error.response?.status}, Message: ${error.response?.data?.message}`
    );
  }
};


// Endpoint to send OTP
app.post("/send-otp", async (req, res) => {
  const { firstName, LastName, company, email, pin } = req.body;
  const membershipCompanyId = pin || null;

  const otp = generateOTP();

  try {
    // Check if email is already registered
    const existingRecords = await base("Member and Non-member sign up details")
      .select({ filterByFormula: `{Email} = "${email}"` })
      .firstPage();

    if (existingRecords.length > 0) {
      return res.status(400).json({ error: "This email is already registered. Please use a different email." });
    }

    // Verify Company ID if provided
    let memberType = null;
    if (membershipCompanyId) {
      memberType = await checkCompanyId(membershipCompanyId);
      if (!memberType) {
        return res.status(400).json({ error: "Invalid Company ID." });
      }
    }
    

    // Send OTP via email
    const mailOptions = {
      from: `"BIAW" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "Your OTP Code",
      text: `Hello ${firstName || "User"} ${LastName || ""},\n\nYour OTP code is: ${otp}\n\nPlease use this code to complete your verification.`,
      html: `<p>Hello ${firstName || "User"} ${LastName || ""},</p><p>Your OTP code is: <strong>${otp}</strong></p><p>Please use this code to complete your verification.</p>`,
    };

    await transporter.sendMail(mailOptions);

    // Save data to Airtable without Member Type
    await base("Member and Non-member sign up details").create([
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

    res.status(200).json({ message: "OTP sent successfully and data added to Airtable", otp, memberType });
  } catch (error) {
    console.error("Error sending OTP:", error);
    res.status(500).json({ error: "Failed to send OTP or add data to Airtable", details: error.message });
  }
});


// Endpoint to verify OTP
app.post("/verify-otp", async (req, res) => {
  const { email, otp } = req.body;

  try {
    // Verify email and OTP in Airtable
    const records = await base("Member and Non-member sign up details")
      .select({
        filterByFormula: `AND({Email} = '${email}', {Verification Code} = '${otp}')`,
      })
      .firstPage();

    if (records.length === 0) {
      return res.status(400).json({ error: "Invalid email or OTP." });
    }

    const record = records[0];
    const { "First Name": firstName, "Last Name": lastName, "Company": company,"Membership Company ID": membershipCompanyId, "Member Type": memberType } = record.fields;

    // Prepare data for Memberstack
    const memberData = {
      email,
      password: "defaultPassword123", // Use a secure default or generated password
      customFields: {
        "first-name": firstName || "", // Default to empty string if undefined
        "last-name": lastName || "",
        company: company || "N/A", 
        "companyid":membershipCompanyId,// Default to "N/A" if no company provided
        "mbr-type": memberType || "Standard", // Default to "Standard" if no member type provided
      },
    };

    console.log("Data being sent to Memberstack:", memberData);

    // Send data to Memberstack
    const memberstackResponse = await createMemberInMemberstack(memberData);

    console.log("Memberstack Response:", memberstackResponse);

    // Respond with success message
    return res.status(200).json({
      message: "OTP verified successfully and Member created in Memberstack.",
      memberstackResponse,
    });
  } catch (error) {
    console.error("Error verifying OTP or sending data to Memberstack:", error.response?.data || error.message);

    res.status(500).json({
      error: "Server error while verifying OTP.",
      details: error.response?.data || error.message,
    });
  }
});


// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
