const express = require("express");
const nodemailer = require("nodemailer");
const cors = require("cors");
require("dotenv").config();
const Airtable = require("airtable");
const axios = require("axios");

const app = express();

// CORS configuration
const allowedOrigins = [
  "https://biaw-stage-api.webflow.io",
  "https://biaw-stage-api.webflow.io/signup",
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


app.post("/send-otp", async (req, res) => {
  const { firstName, LastName, company, email, Pin } = req.body;
  const membershipCompanyId = Pin;

  const otp = generateOTP();
  let memberType ="";

  try {
    // If a membership company ID (Pin) is provided, check its validity
    if (membershipCompanyId) {
      memberType = await checkCompanyId(membershipCompanyId);
      if (!memberType) {
        return res.status(400).json({ error: "Invalid Company ID." });
      }
    }

    // Check if email is already registered
    const existingRecords = await base("Member and Non-member sign up details")
      .select({ filterByFormula: `{Email} = "${email}"` })
      .firstPage();

    if (existingRecords.length > 0) {
      const existingRecord = existingRecords[0];
      const verificationStatus = existingRecord.fields["Verification Status"];

      // If Verification Status is empty or null, allow sending OTP again
      if (!verificationStatus) {
        // Update existing record with new OTP and Membership Company ID (Pin)
        await base("Member and Non-member sign up details").update([
          {
            id: existingRecord.id,
            fields: {
              "Verification Code": otp,
            },
          },
        ]);
      } else {
        // If Verification Status exists, return error message
        return res.status(400).json({ error: "Email already verified or OTP already sent." });
      }
    } else {
      // If email doesn't exist, proceed with creating a new record
      await base("Member and Non-member sign up details").create([{
        fields: {
          "First Name": firstName,
          "Last Name": LastName,
          "Email": email,
          "Company": company,
          "Membership Company ID": membershipCompanyId, // Add Pin to Airtable
          "Verification Code": otp,
        },
      }]);
    }

    // Send OTP via email (same logic for both updating and creating records)
    const mailOptions = {
      from: `"BIAW" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "Your OTP Code",
      text: `Hello ${firstName || "User"} ${LastName || ""},\n\nThank you for joining! To finish signing up, Please verify your email.
       Your verification is below -- enter it in your open browser window and we'll get you signed in!\n\n
       \n\nYour OTP code is: ${otp}\n\n

       \n\nhttps://biaw-stage-api.webflow.io/account-verification\n\n
       \n\nIf you didn’t request this email, there’s nothing to worry about — you can safely ignore it.\n\n

       \n\nWelcome and thanks!.\n\n`,
      html: `<p>Hello ${firstName || "User"} ${LastName || ""},</p>
      <p>Thank you for joining! To finish signing up, Please verify your email.
      Your verification is below -- enter it in your open browser window and we'll get you signed in!</p>
      <p>Your OTP code is: <strong>${otp}</strong></p>
      <p><a href="https://biaw-stage-api.webflow.io/account-verification"></a></p>
      <p>Please use this code to complete your verification.</p>`,
    };

    await transporter.sendMail(mailOptions);

    // Return the response with memberType (if applicable)
    res.status(200).json({ message: "OTP sent successfully", otp, memberType });

  } catch (error) {
    console.error("Error sending OTP:", error);
    res.status(500).json({ error: "Failed to send OTP or add data to Airtable", details: error.message });
  }
});




app.post("/verify-otp", async (req, res) => {
  const { email, otp ,memberType } = req.body;

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

    return res.status(200).json({
      message: "OTP verified successfully.",
      email, // Return email to the frontend for further steps
      memberType
    });
  } catch (error) {
    console.error("Error verifying OTP:", error.message);
    res.status(500).json({
      error: "Server error while verifying OTP.",
      details: error.message,
    });
  }
});

app.post("/set-password", async (req, res) => {
  const { password, confirmPassword, email ,memberType  } = req.body;

  try {
    if (!password || !confirmPassword || !email) {
      return res.status(400).json({ error: "Password, Confirm Password, and Email are required." });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({ error: "Passwords do not match." });
    }

    // Fetch the user record from Airtable
    const records = await base("Member and Non-member sign up details")
      .select({ filterByFormula: `{Email} = '${email}'` })
      .firstPage();

    if (records.length === 0) {
      return res.status(404).json({ error: "User not found in Airtable." });
    }

    const record = records[0];
    const {
      "First Name": firstName,
      "Last Name": lastName,
      "Company": company,
      "Membership Company ID": membershipCompanyId,
    } = record.fields;

    // Prepare data for Memberstack
    const memberData = {
      email,
      password,
      customFields: {
        "first-name": firstName || "",
        "last-name": lastName || "",
        company: company || "N/A",
        "companyid": membershipCompanyId || "",
        "mbr-type": memberType || "",
      },
    };

    // Call the Memberstack API
    const memberstackResponse = await createMemberInMemberstack(memberData);

    if (memberstackResponse.error) {
      throw new Error(memberstackResponse.error);
    }

    // Update Airtable with Memberstack Member ID
    await base("Member and Non-member sign up details").update(record.id, {
      "Member ID": memberstackResponse.data.id,
      "Verification Status": "Verified",
    });

    res.status(200).json({
      message: "Member created successfully in Memberstack.",
      memberstackResponse,
    });
  } catch (error) {
    console.error("Error in set-password:", error.message);
    res.status(500).json({
      error: "Failed to create Memberstack member.",
      details: error.message,
    });
  }
});



// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
