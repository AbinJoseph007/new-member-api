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
const AIRTABLE_TABLE_NAME2 = process.env.AIRTABLE_TABLE_NAME2;
const AIRTABLE_TABLE_NAME3 = process.env.AIRTABLE_TABLE_NAME3

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
    "X-API-KEY": process.env.MEMBERSTACK_API_KEY,
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
  let memberType = "";

  try {
    // Validate Membership Company ID (if provided)
    if (membershipCompanyId) {
      memberType = await checkCompanyId(membershipCompanyId);
      if (!memberType) {
        return res.status(400).json({ error: "Invalid Company ID." });
      }
    }

    // Check if the email is already registered
    const existingRecords = await base("Member and Non-member sign up details")
      .select({ filterByFormula: `{Email} = "${email.replace(/"/g, '\\"')}"` })
      .firstPage();

      let emailSubject = "Your OTP Code";
      let emailText = `Hello ${firstName || "User"} ${LastName || ""},\n\nThank you for joining! To finish signing up, please verify your email.
      Your verification code is below. Enter it in your open browser window to complete the process.\n\n
      Your OTP code is: ${otp}\n\n
      To complete your verification, please click the following link:\n\n
      https://biaw-stage-api.webflow.io/account-verification?memberType=${encodeURIComponent(memberType)}\n\n
      If you didn’t request this email, please ignore it.\n\n
      Welcome and thanks!\n\n`;
      
      let emailHtml = `<p>Hello ${firstName || "User"} ${LastName || ""},</p>
      <p>Thank you for joining! To finish signing up, please verify your email.</p>
      <p>Your verification code is: <strong>${otp}</strong></p>
      <p>To complete your verification, please click the link below:</p>
      <p><a href="https://biaw-stage-api.webflow.io/account-verification?memberType=${encodeURIComponent(memberType)}">Click here to verify your email</a></p>
      <p>If you didn’t request this email, please ignore it.</p>
      <p>Welcome and thanks!</p>`;
      
      // Handle existing records
      if (existingRecords.length > 0) {
        const existingRecord = existingRecords[0];
        const verificationStatus = existingRecord.fields["Verification Status"];
      
        if ((!verificationStatus || verificationStatus === "Not Verified")) {
          // Update the existing record with new OTP and user details
          await base("Member and Non-member sign up details").update([{
            id: existingRecord.id,
            fields: {
              "Verification Code": otp,
              "First Name": firstName,
              "Last Name": LastName,
              "Company": company,
              "Membership Company ID": membershipCompanyId,
            },
          }]);
      
          // Update email content for users who already registered but are unverified
          emailSubject = "Your Updated OTP Code";
          emailText = `Hello ${firstName || "User"} ${LastName || ""},\n\nIt seems you've already tried to register with us but didn't complete the verification process. No worries! We've generated a new OTP for you to complete your registration.\n\n
      Your new OTP code is: ${otp}\n\n
      To complete your verification, please click the following link:\n\n
      https://biaw-stage-api.webflow.io/account-verification?memberType=${encodeURIComponent(memberType)}\n\n
      If you didn’t request this email, please ignore it.\n\n
      Welcome and thanks!\n\n`;
      
          emailHtml = `<p>Hello ${firstName || "User"} ${LastName || ""},</p>
      <p>It seems you've already tried to register with us but didn't complete the verification process. No worries! We've generated a new OTP for you to complete your registration.</p>
      <p>Your new OTP code is: <strong>${otp}</strong></p>
      <p>To complete your verification, please click the link below:</p>
      <p><a href="https://biaw-stage-api.webflow.io/account-verification?memberType=${encodeURIComponent(memberType)}">Click here to verify your email</a></p>
      <p>If you didn’t request this email, please ignore it.</p>
      <p>Welcome and thanks!</p>`;
      
        } else {
          return res.status(400).json({ error: "Email already verified or OTP already sent." });
        }
    } else {
      // Create a new record for first-time users
      await base("Member and Non-member sign up details").create([
        {
          fields: {
            "First Name": firstName,
            "Last Name": LastName,
            "Email": email,
            "Company": company,
            "Membership Company ID": membershipCompanyId,
            "Verification Code": otp,
            "Verification Status": "Not Verified",
          },
        },
      ]);
    }

    // Send the email
    const mailOptions = {
      from: `"BIAW Support" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: emailSubject,
      text: emailText,
      html: emailHtml,
    };

    await transporter.sendMail(mailOptions);

    // Return success response
    res.status(200).json({ message: "OTP sent successfully", otp, memberType });
  } catch (error) {
    console.error("Error sending OTP:", error);
    res.status(500).json({ error: "Failed to send OTP or add data to Airtable", details: error.message });
  }
});




app.post("/verify-otp", async (req, res) => {
  const { email, otp, memberType } = req.body;

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
  const { password, confirmPassword, email, memberType, membershipCompanyId } = req.body;

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
      "Membership Company ID": existingCompanyId,
    } = record.fields;

    // Prepare data for Memberstack
    const memberData = {
      email,
      password,
      customFields: {
        "first-name": firstName || "",
        "last-name": lastName || "",
        company: company || "N/A",
        "companyid": membershipCompanyId || existingCompanyId || "",
        "mbr-type": memberType || "", // Default to Non-Member if not provided
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

    // Log the incoming values to verify correct behavior
    console.log("membershipCompanyId:", membershipCompanyId);
    console.log("memberType:", memberType);

    // Determine the email content based on whether companyId and memberType are provided
    let emailSubject = "Your Account Has Been Successfully Verified";
    let emailText = `Dear ${firstName} ${lastName},\n\nCongratulations! Your account has been successfully Verified. We’re excited to have you as part of our community.\n\nYou can now log in using your email ${email} and explore all the features we offer. If you ever need any assistance or have any questions, feel free to reach out to our support team.\n\nThank you for joining us, and we look forward to providing you with an excellent experience!\n\nBest regards,\nBIAW Support Team`;
    let emailHtml = `<p>Dear ${firstName} ${lastName},</p><p>Congratulations! Your account has been successfully Verified. We’re excited to have you as part of our community.</p><p>You can now log in using your email ${email} and explore all the features we offer. If you ever need any assistance or have any questions, feel free to reach out to our support team.</p><p>Thank you for joining us, and we look forward to providing you with an excellent experience!</p><p>Best regards,<br>BIAW Support Team</p>`;

    // Check if either membershipCompanyId or memberType is not provided
    if (!memberType) {
      emailSubject = "Welcome to BIAW – Non-Member Registration";
      emailText = `Dear ${firstName} ${lastName},\n\nCongratulations! Your account has been successfully Verified ,You are signed up as a non-member. If you have a company ID or would like to upgrade your non-member status to a member, please visit this page to update your information: https://biaw-stage-api.webflow.io/reset-pin.\n\nIf you have any questions or need further assistance, feel free to reach out to our support team.\n\nBest regards,\nBIAW Support Team`;
      emailHtml = `<p>Dear ${firstName} ${lastName},</p><p>Congratulations! Your account has been successfully Verified. You are signed up as a non-member. If you have a company ID or would like to upgrade your non-member status to a member, please visit this page to update your information: <a href="https://biaw-stage-api.webflow.io/reset-pin">https://biaw-stage-api.webflow.io/reset-pin</a>.</p><p>If you have any questions or need further assistance, feel free to reach out to our support team.</p><p>Best regards,<br>BIAW Support Team</p>`;
    }

    // Send the confirmation email
    const mailOptions = {
      from: `"BIAW Support" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: emailSubject,
      text: emailText,
      html: emailHtml,
    };

    // Send the email
    await transporter.sendMail(mailOptions);

    res.status(200).json({
      message: "Member created successfully in Memberstack, and email sent.",
      memberstackResponse,
    });
  } catch (error) {
    console.error("Error in set-password:", error.message);
    res.status(500).json({
      error: "Failed to create Memberstack member and send email.",
      details: error.message,
    });
  }
});



//memberid verification

async function checkCompanyIds(companyId) {
  const records = await base("NAHB Data")
    .select({ filterByFormula: `{Company ID} = '${companyId}'` })
    .firstPage();

  if (records.length === 0) {
    return null;
  }

  if (records.length > 1) {
    const values = records.map(record => record.fields["Member Type"]);
    return { values, selected: values[0] }; // Default to the first value
  }

  return { values: [records[0].fields["Member Type"]], selected: records[0].fields["Member Type"] };
}

// Helper: Send Email Notification
async function sendNotificationEmail(email, companyId, values, selectedValue) {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASSWORD,
    },
  });

  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: "abinjosephonline.in@gmail.com",
    subject: "Company ID Value Selection",
    text: `The user with the email address: ${email} has applied Member verification using the Company ID: ${companyId}. The ID is associated with multiple values: ${values.join(", ")}. The value "${selectedValue}" has been selected.`,
};

  await transporter.sendMail(mailOptions);
}

// Main Route: Update Company ID
app.post("/update-company-id", async (req, res) => {
  const { email, companyId } = req.body;

  if (!email || !companyId) {
    return res.status(400).json({ error: "Email and Company ID are required." });
  }

  try {
    // Step 1: Check if Company ID exists and fetch member type(s)
    const companyData = await checkCompanyIds(companyId);
    if (!companyData) {
      return res.status(400).json({ error: "Invalid Company ID." });
    }

    const { values, selected } = companyData;

    // If multiple values are found, send an email notification
    if (values.length > 1) {
      await sendNotificationEmail(email, companyId, values, selected);
    }

    const memberType = selected;

    // Step 2: Fetch user record from Airtable
    const userRecords = await base("Member and Non-member sign up details")
      .select({ filterByFormula: `{Email} = '${email}'` })
      .firstPage();

    if (userRecords.length === 0) {
      return res.status(404).json({ error: "User not found in Airtable." });
    }

    const userRecord = userRecords[0];

    // Step 3: Update Airtable
    await base("Member and Non-member sign up details").update(userRecord.id, {
      "Membership Company ID": companyId,
    });

    // Step 4: Update Memberstack
    const memberId = userRecord.fields["Member ID"];
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
          companyid: companyId,
          "mbr-type": memberType,
        },
      },
      { headers }
    );

    // Step 5: Fetch and update the "Members" table
    const memberRecords = await base("Members")
      .select({ filterByFormula: `{Email Address} = '${email}'` })
      .firstPage();

    if (memberRecords.length === 0) {
      return res.status(404).json({ error: "Member not found in the 'Members' table." });
    }

    const memberRecord = memberRecords[0];
    await base("Members").update(memberRecord.id, {
      "Company ID Used": companyId,
      "User": memberType,
      "UserType": "Member",
      "Membership Update Status":"Updated"
    });

    // Step 6: Send success response
    res.status(200).json({ message: "Company ID updated successfully." });
  } catch (error) {
    console.error("Error updating Company ID:", error.message);
    res.status(500).json({ error: "Failed to update Company ID.", details: error.message });
  }
});


// Endpoint to handle form submission for member id
app.post('/submit', async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  try {
    // Check Airtable for the email
    const records = await base(AIRTABLE_TABLE_NAME2)
      .select({ filterByFormula: `{Contact Email Address} = "${email}"` })
      .firstPage();

    if (records.length === 0) {
      // Email not found in Airtable
      await transporter.sendMail({
        from: `"BIAW Support" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: 'Membership Information',
        text: 'Your email is not matching any Company ID. You cannot be a member. Contact your local support \n\nIf you ever need any assistance or have any questions, feel free to reach out to our support team.\n\nBest regards,\nBIAW Support Team',
      });
      return res.status(200).json({ message: 'Email not found. Notification sent.' });
    }

    // Email found, get Company ID
    const companyID = records[0].fields['Company ID'];
    await transporter.sendMail({
      from: `"BIAW Support" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: 'Your Company ID',
      text: `Your Company ID is: ${companyID} \n\nIf you ever need any assistance or have any questions, feel free to reach out to our support team.\n\nBest regards,\nBIAW Support Team`,
    });
    res.status(200).json({ message: 'Company ID sent to the email.' });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'An error occurred' });
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
    from: `"BIAW Support" <${process.env.EMAIL_USER}>`,
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
        const emailText = 'Hello, your Memberstack account has been successfully updated.';
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
async function updateAirtableAfterCreatingMember(recordId, memberId, email, cleanedPassword, firstName, lastName) {
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
    const emailText = `Hello ${firstName} ${lastName}\n\nyour Memberstack Director account has been successfully created.\n\nHere are your account details: \nyour Email: ${email}\nyour password : ${cleanedPassword} `;
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



// async function runPeriodicallys(intervalMs) {
//   console.log("Starting periodic sync...");
//   setInterval(async () => {
//     console.log(`Running sync at ${new Date().toISOString()}`);
//     await processRecords();
//   }, intervalMs);
// }

// runPeriodicallys(20 * 1000);


const AIRTABLE_URL2 = `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/${process.env.AIRTABLE_TABLE_NAME3}`;

// Fetch records from Airtable
async function fetchUpdatedAirtableRecords() {
  try {
    const response = await axios.get(AIRTABLE_URL2, { headers: airtableHeaders });
    const records = response.data.records.filter(
      (record) => record.fields['Membership Update Status'] === 'Membership update status'
    );
    console.log(`Fetched ${records.length} records to update.`);
    return records;
  } catch (error) {
    console.error('Error fetching Airtable records:', error.response?.data || error.message);
    return [];
  }
}

// Update Memberstack member details
async function updateMemberstackDetails(userId, memberUpdateData) {
  try {
    console.log(`Updating Memberstack member ${userId}...`);
    const response = await axios.patch(`${MEMBERSTACK_URL}/${userId}`, memberUpdateData, {
      headers: memberstackHeaders,
    });
    console.log(`Memberstack member ${userId} updated successfully.`);
    return response.data;
  } catch (error) {
    console.error(`Error updating Memberstack member ${userId}:`, error.response?.data || error.message);
    throw error;
  }
}

// Update Airtable record after Memberstack update
async function updateAirtableRecord(recordId) {
  try {
    const url = `${AIRTABLE_URL2}/${recordId}`;
    const data = {
      fields: {
        'Membership Update Status': 'Updated',
      },
    };
    console.log(`Updating Airtable record ${recordId}...`);
    const response = await axios.patch(url, data, { headers: airtableHeaders });
    console.log(`Airtable record ${recordId} updated successfully.`);
  } catch (error) {
    console.error(`Error updating Airtable record ${recordId}:`, error.response?.data || error.message);
  }
}

// Process and update records
async function processAndUpdateRecords() {
  try {
    const records = await fetchUpdatedAirtableRecords();

    for (const record of records) {
      const { id: recordId, fields } = record;
      const userId = fields['Member ID']; // Changed from `memberId` to `userId`

      if (!userId) {
        console.warn(`No Member ID found for record ${recordId}, skipping.`);
        continue;
      }

      const memberUpdateData = { // Changed `updateData` to `memberUpdateData`
        customFields: {
          companyid: fields['Company ID Used'] || '',
          'mbr-type': fields['User'] || '',
        },
      };

      try {
        await updateMemberstackDetails(userId, memberUpdateData);
        await updateAirtableRecord(recordId);
      } catch (error) {
        console.error(`Failed to update Memberstack or Airtable for record ${recordId}.`);
      }
    }
  } catch (error) {
    console.error('Error processing records:', error.message);
  }
}


// Function for the periodic sync task
async function runPeriodicallySync(intervalMs) {
  console.log("Starting periodic sync...");
  setInterval(async () => {
    console.log(`Running sync at ${new Date().toISOString()}`);
    await processRecords();  // Call the processRecords function here
  }, intervalMs);
}

// Function to run update process
async function runPeriodicUpdate(intervalMs) {
  console.log("Starting periodic update...");
  setInterval(async () => {
    console.log(`Running update process at ${new Date().toISOString()}`);
    await processAndUpdateRecords();  // Call the processRecords function here
  }, intervalMs);
}

// Call processRecords() immediately first
console.log('Running processRecords immediately...');
processRecords();

// Run the periodic sync (every 20 seconds)
runPeriodicallySync(40 * 1000);

// Run the update process (every 15 minutes)
runPeriodicUpdate(1 * 60 * 1000);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
