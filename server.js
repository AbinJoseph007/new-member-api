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




const AIRTABLE_URL = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_NAME}`;
const MEMBERSTACK_URL = 'https://admin.memberstack.com/members';

const airtableHeaders = {
  Authorization: `Bearer ${AIRTABLE_API_KEY}`,
  'Content-Type': 'application/json',
};

const memberstackHeaders = {
  "X-API-KEY": process.env.MEMBERSTACK_API_KEY,
  'Content-Type': 'application/json',
};

// Fetch Airtable records
async function fetchAirtableRecords() {
  try {
    const response = await axios.get(AIRTABLE_URL, { headers: airtableHeaders });
    return response.data.records;
  } catch (error) {
    console.error('Error fetching Airtable records:', error);
    return [];
  }
}

// Check if the email exists in Memberstack and return the corresponding member ID
async function checkMemberstackEmail(email) {
  try {
    const response = await axios.get(MEMBERSTACK_URL, {
      headers: memberstackHeaders,
      params: { email },  // This should return the member's ID if email is found
    });

    console.log(`Memberstack response for email ${email}:`, response.data);  // Debugging line

    if (Array.isArray(response.data.members) && response.data.members.length > 0) {
      return response.data.members[0].id;  // Return the member ID if found
    }
    return null;  // Return null if the email is not found
  } catch (error) {
    console.error('Error checking Memberstack email:', error);
    return null;  // Return null if there's an error in fetching member data
  }
}

// Update Memberstack member with the new field
async function updateMemberstack(memberId, memberData) {
  try {
    const url = `https://admin.memberstack.com/members/${memberId}`;
    const response = await axios.patch(url, memberData, { headers: memberstackHeaders });
    return response.data;
  } catch (error) {
    console.error('Error updating Memberstack member:', error);
    throw new Error('Failed to update Memberstack member');
  }
}

// Create a new Memberstack member
async function createMemberstack(memberData) {
  try {
    const response = await axios.post(MEMBERSTACK_URL, memberData, { headers: memberstackHeaders });
    return response.data;
  } catch (error) {
    if (error.response && error.response.data && error.response.data.code === 'email-already-in-use') {
      console.error(`Email ${memberData.email} is already in use. Updating member instead.`);
      return null;  // If email already exists, return null to update instead
    }
    console.error('Error creating Memberstack member:', error);
    throw new Error('Failed to create Memberstack member');
  }
}

// Update Airtable with Member ID
async function updateAirtableRecord(recordId, memberId) {
  try {
    const url = `${AIRTABLE_URL}/${recordId}`;
    const data = {
      fields: {
        'Member ID': memberId,  // Store the Memberstack ID in Airtable
        'Create Account': 'Created/Updated',  // Mark as Created/Updated
      },
    };
    await axios.patch(url, data, { headers: airtableHeaders });
  } catch (error) {
    console.error('Error updating Airtable record:', error);
    throw new Error('Failed to update Airtable record');
  }
}

// Main process
async function processRecords() {
  try {
    const records = await fetchAirtableRecords();

    for (const record of records) {
      const { id, fields } = record;
      const { 'First Name': firstName, 'Last Name': lastName, Email: email, User, Password, 'Create Account': createAccount } = fields;

      // Process only if "Create Account" is set to 'Create/update'
      if (createAccount === 'Create/update') {
        console.log(`Processing record for email: ${email}`);

        // Check if the email already exists in Memberstack and get the member ID
        const memberId = await checkMemberstackEmail(email);
        console.log(`Memberstack memberId for email ${email}:`, memberId);

        if (memberId) {
          // If the member exists, update the Director field
          const memberData = {
            customFields: { director: 'Director' },
          };

          try {
            const updatedMember = await updateMemberstack(memberId, memberData);
            console.log(`Updated member: ${email} with ID ${updatedMember.id}`);

            // Update Airtable with the new Member ID
            await updateAirtableRecord(id, updatedMember.id);
          } catch (error) {
            console.error('Error updating existing member:', error);
          }
        } else {
          console.log(`No member found for email ${email}. Creating new member...`);

          // If no member exists, create a new member in Memberstack
          const newMemberData = {
            email,
            password: Password,  // Ensure Password is passed here from Airtable
            customFields: {
              "first-name": firstName || "",
              "last-name": lastName || "",
              company: fields['Company Name'] || "",  // Use Company Name if available
              "companyid": fields['Company ID'] || "", // Use Company ID if available
              "director": "Director",  // Mark as director
              "mbr-type": User || "",
            },
          };

          try {
            const newMember = await createMemberstack(newMemberData);

            if (newMember && newMember.data && newMember.data.id) {
              const newMemberId = newMember.data.id;  // Get the ID from the response

              // Update Airtable with the new member's ID and mark as "Created/Updated"
              await updateAirtableRecord(id, newMemberId);
              console.log(`Created new member: ${email} with ID ${newMemberId}`);
            }
          } catch (error) {
            console.error('Error creating new member:', error);
          }
        }
      } else {
        console.log(`Skipping record for email: ${email} (Create Account is not 'Create/update')`);
      }
    }
  } catch (error) {
    console.error('Error processing records:', error);
  }
}

// Execute the process
processRecords();


// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
