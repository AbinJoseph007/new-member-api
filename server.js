const express = require("express");
const nodemailer = require("nodemailer");
const cors = require("cors");
require("dotenv").config();
const Airtable = require("airtable");
const axios = require("axios");
const cron = require('node-cron');


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


const AIRTABLE_TABLE_NAME = process.env.AIRTABLE_TABLE_NAME
const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const MEMBERSTACK_API_KEY = process.env.MEMBERSTACK_API_KEY;

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

              //new update
              "First Name": firstName, // Update First Name
              "Last Name": LastName,   // Update Last Name
              "Company": company,      // Update Company
              "Membership Company ID": membershipCompanyId, // Update Membership Company ID
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
          "Verification Status": "Not Verified"
        },
      }]);
    }

    // Send OTP via email (same logic for both updating and creating records)
    const mailOptions = {
      from: `"BIAW Support" <${process.env.EMAIL_USER}>`,
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
        "director": "Non-Director",
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

//memberid verification

app.post("/update-company-id", async (req, res) => {
  const { email, companyId } = req.body;

  if (!email || !companyId) {
    return res.status(400).json({ error: "Email and Company ID are required." });
  }

  try {
    // Step 1: Check if Company ID exists in the "NAHB Data" table
    const memberType = await checkCompanyId(companyId);
    if (!memberType) {
      return res.status(400).json({ error: "Invalid Company ID." });
    }

    // Step 2: Fetch user record from Airtable
    const records = await base("Member and Non-member sign up details")
      .select({ filterByFormula: `{Email} = '${email}'` })
      .firstPage();

    if (records.length === 0) {
      return res.status(404).json({ error: "User not found in Airtable." });
    }

    const record = records[0];

    // Step 3: Update Airtable
    await base("Member and Non-member sign up details").update(record.id, {
      "Membership Company ID": companyId,
    });

    // Step 4: Update Memberstack
    const memberId = record.fields["Member ID"]; // Assuming Member ID exists
    if (!memberId) {
      return res.status(404).json({ error: "Member ID not found in Airtable." });
    }

    const memberstackUpdateUrl = `https://admin.memberstack.com/members/${memberId}`;
    const headers = {
      "X-API-KEY": process.env.MEMBERSTACK_API_KEY,
      "Content-Type": "application/json",
    };

    await axios.patch(
      memberstackUpdateUrl,
      {
        customFields: {
          "companyid": companyId,
          "mbr-type": memberType, // Optional: Update Member Type as well
        },
      },
      { headers }
    );

     // Step 5: Fetch record from "Members" table and update with the new Company ID
     const memberRecords = await base("Members")
     .select({ filterByFormula: `{Email Address} = '${email}'` })
     .firstPage();

   if (memberRecords.length === 0) {
     return res.status(404).json({ error: "Member not found in the 'Members' table." });
   }

   const memberRecord = memberRecords[0];

   // Update the "Members" table with the new Company ID and User type
   await base("Members").update(memberRecord.id, {
     "Company ID Used": companyId, // Update "Company ID Used" field
     "User": memberType, 
     "UserType":"Member" // Optional: Update Member Type as well
     // Update "User" field with member type
   });

    // Step 5: Send success response
    res.status(200).json({ message: "Company ID updated successfully." });
  } catch (error) {
    console.error("Error updating Company ID:", error.message);
    res.status(500).json({ error: "Failed to update Company ID.", details: error.message });
  }
});



// URLs and API keys
const AIRTABLE_URL = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_NAME}`;
const MEMBERSTACK_URL = 'https://admin.memberstack.com/members';

// Airtable and Memberstack headers
const airtableHeaders = {
  Authorization: `Bearer ${AIRTABLE_API_KEY}`,
  'Content-Type': 'application/json',
};

const memberstackHeaders = {
  'X-API-KEY': process.env.MEMBERSTACK_API_KEY,
  'Content-Type': 'application/json',
};


// Helper function to send email
async function sendEmail(to, subject, text) {
  const mailOptions = {
    from:`"BIAW Support" <${process.env.EMAIL_USER}>`,
    to: to,
    subject: subject,
    text: text,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log('Email sent:', info.response);
  } catch (error) {
    console.error('Error sending email:', error);
  }
}

// Fetch Airtable records
async function fetchAirtableRecords() {
  try {
    const response = await axios.get(AIRTABLE_URL, { headers: airtableHeaders });
    console.log(`Fetched ${response.data.records.length} Airtable records`);
    return response.data.records;
  } catch (error) {
    console.error('Error fetching Airtable records:', error.response ? error.response.data : error.message);
    return [];
  }
}

// Check if Memberstack member exists by email
async function checkMemberstackEmail(email) {
  try {
    console.log(`Checking Memberstack for email: ${email}`);
    const response = await axios.get(MEMBERSTACK_URL, {
      headers: memberstackHeaders,
      params: { email },
    });

    console.log('Memberstack email check response:', response.data);

    const member = response.data.data?.find(m => m.auth?.email === email);

    if (!member) {
      console.log(`No member found for email: ${email}`);
      return null;  
    }

    console.log(`Found Memberstack member: ${member.auth.email}`);
    return member.id; 
  } catch (error) {
    console.error('Error checking Memberstack email:', error.response ? error.response.data : error.message);
    return null;
  }
}

// Create a new Memberstack member
async function createMemberstackMember(newMemberData) {
  try {
    console.log('Creating new Memberstack member...');
    const response = await axios.post(MEMBERSTACK_URL, newMemberData, { headers: memberstackHeaders });
    console.log('New Memberstack member created:', response.data);

    // Check if the response data contains the expected member ID
    const memberId = response.data?.data?.id; // Adjust based on actual API response structure
    if (!memberId) {
      console.error('Error: Member ID not found in response data.');
      return null;
    }

    return memberId;
  } catch (error) {
    console.error('Error creating Memberstack member:', error.response ? error.response.data : error.message);
    throw error;
  }
}


// Update Memberstack member details
async function updateMemberstack(recordId, memberId, updateData) {
  try {
    console.log(`Updating Memberstack for memberId: ${memberId}`); 
    const url = `${MEMBERSTACK_URL}/${memberId}`;
    console.log('Updating Memberstack member...', updateData);
    const response = await axios.patch(url, updateData, { headers: memberstackHeaders });

    console.log('Full Memberstack member update response:', JSON.stringify(response.data, null, 2));

    const updatedMemberId = response.data?.data?.id || null;

    if (updatedMemberId) {
      console.log('Successfully extracted updatedMemberId:', updatedMemberId);

      // Update Airtable after the Memberstack update
      await updateAirtableAfterUpdatingMember(recordId, updatedMemberId);

      // Extract email from updateData
      const email = updateData?.email || updateData?.auth?.email;

      // Console log the email before sending
      console.log(`Email extracted for notification: ${email}`);

      // Check if email exists and send email
      if (email) {
        const emailSubject = 'Your Memberstack Account Has Been Updated';
        const emailText = 'Hello, your Memberstack account has been successfully updated.\n\nYou are now a Director';
        await sendEmail(email, emailSubject, emailText);
      } else {
        console.error('Email address not found in updateData. Skipping email notification.');
      }
    } else {
      console.error('Error: Updated Memberstack ID not found in response. Response did not contain id.');
    }
  } catch (error) {
    console.error('Error updating Memberstack member:', error.response ? error.response.data : error.message);
  }
}


// Update Airtable after creating a new Memberstack member
async function updateAirtableAfterCreatingMember(recordId, memberId, email,cleanedPassword ,firstName, lastName) {
  try {
    const url = `${AIRTABLE_URL}/${recordId}`;
    const data = {
      fields: {
        'Member ID': memberId,
        'Create Account': 'Created/Updated',
        'Email': email,
      },
    };
    console.log('Updating Airtable after creating Memberstack member...', data);
    const response = await axios.patch(url, data, { headers: airtableHeaders });
    console.log('Airtable updated after creating Memberstack member:', response.data);

    // Send email after creating a new Director
    const emailSubject = 'Your Memberstack Account Has Been Created';
    const emailText = `Hello ${firstName} ${lastName}\n\n your Memberstack Director account has been successfully created.\n\nHere are your account details: \n your Email: ${email}\n your password : ${cleanedPassword} `;
    await sendEmail(email, emailSubject, emailText);
  } catch (error) {
    console.error('Error updating Airtable after creating Memberstack member:', error.response ? error.response.data : error.message);
  }
}

// Update Airtable after updating an existing Memberstack member
async function updateAirtableAfterUpdatingMember(recordId, updatedMemberId) {
  try {
    console.log('Updating Airtable with recordId:', recordId);
    console.log('Updated Member ID:', updatedMemberId);

    if (!updatedMemberId) {
      console.error('Error: Cannot update Airtable because updatedMemberId is missing');
      return;  
    }

    const url = `${AIRTABLE_URL}/${recordId}`;
    const data = {
      fields: {
        'Create Account': 'Created/Updated',
        'Member ID': updatedMemberId, 
      },
    };

    console.log('Data being sent to Airtable:', data);

    const response = await axios.patch(url, data, { headers: airtableHeaders });
    console.log('Airtable updated after updating Memberstack member:', response.data);
  } catch (error) {
    console.error('Error updating Airtable after updating Memberstack member:', error.response ? error.response.data : error.message);
  }
}


async function processRecords() {
  try {
    const records = await fetchAirtableRecords();

    for (const record of records) {
      const { id, fields } = record;
      const {
        Email: email,
        'First Name': firstName,
        'Last Name': lastName,
        'Company Name': companyName,
        'Company ID': companyId,
        Password,
        User,
        'Create Account': createAccount,
        Director, // This is the checkbox field
      } = fields;

      console.log(`Processing record for email: ${email}`);

      if (createAccount === 'Create/update') {
        let memberId = await checkMemberstackEmail(email);

        // Trim the password to remove any leading/trailing spaces
        const cleanedPassword = Password ? Password.trim() : '';

        // Skip if password is invalid
        if (!cleanedPassword || cleanedPassword.length < 8) {
          console.log(`Password for ${email} is invalid (must be at least 8 characters). Skipping...`);
          continue;
        }

        const memberData = {
          email,
          password: cleanedPassword,
          customFields: {
            "first-name": firstName || "",
            "last-name": lastName || "",
            company: companyName || "",
            companyid: companyId || "",
            director: Director ? "Director" : "Non-Director", // Set based on the Director checkbox
            "mbr-type": User || "",
          },
        };

        if (memberId) {
          console.log(`Memberstack member found for ${email}. Updating...`);
          await updateMemberstack(id, memberId, memberData);
        } else {
          console.log(`No Memberstack member found for ${email}. Creating new member...`);
          const newMemberId = await createMemberstackMember({ email, password: cleanedPassword, customFields: memberData.customFields });

          if (newMemberId) {
            await updateAirtableAfterCreatingMember(id, newMemberId, email, cleanedPassword, firstName, lastName);
          } else {
            console.error('Failed to create new Memberstack member. Skipping Airtable update.');
          }
        }
      } else {
        console.log(`Skipping record for email: ${email} (Create Account is not 'Create/update')`);
      }
    }
  } catch (error) {
    console.error('Error processing records:', error.response ? error.response.data : error.message);
  }
}



// Schedule a cron job to run every 30 seconds
cron.schedule('*/50 * * * * *', () => {
  console.log('Running scheduled task...');
  processRecords();
});

console.log('Cron job started. Processing records every 30 seconds...');




// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
