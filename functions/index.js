const { setGlobalOptions } = require("firebase-functions");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { defineString } = require("firebase-functions/params");
const { google } = require("googleapis");
const admin = require("firebase-admin");
const nodemailer = require('nodemailer');

admin.initializeApp();
setGlobalOptions({ maxInstances: 10 });

async function sendEmailNotifications(contact, weekData) {
  const recipients = (weekData.followUpRecipients || []).filter(r => r.email && r.email.trim());
  if (recipients.length === 0) return;

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD
    }
  });

  const subject = `📌 New Contact — ${contact.name || 'Unknown'} — ${weekData.label || ''}`;
  const text = [
    `New contact logged for ${weekData.label || ''} (${weekData.city || ''})`,
    '',
    `Name: ${contact.name || ''}`,
    `Phone: ${contact.phone || 'not provided'}`,
    `Gospel Response: ${contact.gospelResponse || ''}`,
    `Logged by: ${contact.loggerName || ''}`,
    '',
    'Notes:',
    contact.notes || 'none',
  ].join('\n');

  await Promise.all(recipients.map(r =>
    transporter.sendMail({ from: process.env.GMAIL_USER, to: r.email, subject, text })
  ));
}

const MASTER_SHEET_ID = defineString("MASTER_SHEET_ID");

exports.onContactCreated = onDocumentCreated(
  { document: "contacts/{contactId}", region: "us-central1" },
  async (event) => {
    try {
      const contact = event.data.data();
      const weekId = contact.weekId;
      console.log("onContactCreated fired. weekId:", weekId);

      if (!weekId) {
        console.warn("Contact missing weekId - skipping Sheets append");
        return;
      }

      const weekDoc = await admin.firestore().collection("weeks").doc(weekId).get();
      if (!weekDoc.exists) {
        console.warn("Week " + weekId + " not found - skipping");
        return;
      }
      const weekData = weekDoc.data();
      const leaderId = weekData.createdBy;
      console.log("Week found. leaderId:", leaderId);

      const userDoc = await admin.firestore().collection("users").doc(leaderId).get();
      const leaderSheetId = userDoc.exists ? userDoc.data().sheetId : null;
      console.log("Leader sheetId:", leaderSheetId);
      console.log("Master sheetId:", MASTER_SHEET_ID.value());

      const auth = new google.auth.GoogleAuth({
        scopes: ["https://www.googleapis.com/auth/spreadsheets"],
      });
      const sheets = google.sheets({ version: "v4", auth });

      const tab = "Followup Contacts";
      const row = [
        contact.clientDate || "",
        weekData.label || "",
        weekData.city || "",
        contact.codeWord || "",
        contact.name || "",
        contact.phone || "",
        "",
        contact.gospelResponse || "",
        contact.followUpRequested ? "Yes" : "No",
        contact.notes || "",
      ];
      console.log("Row to append:", JSON.stringify(row));

      async function appendToSheet(sheetId, label) {
        try {
          console.log("Attempting append to " + label + " sheet:", sheetId);
          const existing = await sheets.spreadsheets.values.get({
            spreadsheetId: sheetId,
            range: tab + "!A1",
          });
          if (!existing.data.values || existing.data.values.length === 0) {
            const headers = ["Date", "Week Name", "City", "Code Word", "Name", "Phone", "Email", "Gospel Response", "Follow-Up?", "Notes"];
            await sheets.spreadsheets.values.append({
              spreadsheetId: sheetId,
              range: tab + "!A1",
              valueInputOption: "RAW",
              insertDataOption: "INSERT_ROWS",
              requestBody: { values: [headers] },
            });
            console.log("Header row inserted into " + label + " sheet");
          }
          await sheets.spreadsheets.values.append({
            spreadsheetId: sheetId,
            range: tab + "!A1",
            valueInputOption: "RAW",
            insertDataOption: "INSERT_ROWS",
            requestBody: { values: [row] },
          });
          console.log("Row appended to " + label + " sheet (" + sheetId + ")");
        } catch (sheetErr) {
          console.error("ERROR appending to " + label + " sheet (" + sheetId + "):", sheetErr.message);
          console.error("Full error:", JSON.stringify(sheetErr));
        }
      }

      if (leaderSheetId) {
        await appendToSheet(leaderSheetId, "leader");
      } else {
        console.warn("User " + leaderId + " has no sheetId set - skipping leader sheet");
      }

      await appendToSheet(MASTER_SHEET_ID.value(), "master");
      console.log("onContactCreated completed successfully");

      try {
        await sendEmailNotifications(contact, weekData);
      } catch (err) {
        console.error('Email notification failed:', err);
      }

    } catch (err) {
      console.error("FATAL ERROR in onContactCreated:", err.message);
      console.error("Stack:", err.stack);
    }
  }
);

exports.onSurveyCreated = onDocumentCreated(
  { document: "surveyResponses/{surveyId}", region: "us-central1" },
  async (event) => {
    try {
      const survey = event.data.data();
      const weekId = survey.weekId;
      console.log("onSurveyCreated fired. weekId:", weekId);

      if (!weekId) {
        console.warn("Survey missing weekId - skipping Sheets append");
        return;
      }

      const weekDoc = await admin.firestore().collection("weeks").doc(weekId).get();
      if (!weekDoc.exists) {
        console.warn("Week " + weekId + " not found - skipping");
        return;
      }
      const weekData = weekDoc.data();
      const leaderId = weekData.createdBy;
      console.log("Week found. leaderId:", leaderId);

      const userDoc = await admin.firestore().collection("users").doc(leaderId).get();
      const leaderSheetId = userDoc.exists ? userDoc.data().sheetId : null;
      console.log("Leader sheetId:", leaderSheetId);
      console.log("Master sheetId:", MASTER_SHEET_ID.value());

      const auth = new google.auth.GoogleAuth({
        scopes: ["https://www.googleapis.com/auth/spreadsheets"],
      });
      const sheets = google.sheets({ version: "v4", auth });

      const tab = "Post-Trip Survey";

      const submittedAt = survey.submittedAt;
      let dateStr = "";
      if (submittedAt) {
        const d = submittedAt.toDate ? submittedAt.toDate() : new Date(submittedAt);
        dateStr = d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
      }

      const row = [
        dateStr,
        weekData.label || "",
        weekData.city || "",
        survey.codeWord || "",
        survey.name || "",
        survey.email || "",
        survey.didPretrip || "",
        survey.pretripImprovements || "",
        survey.gospelShareCount || "",
        survey.mostHelpfulTraining || "",
        survey.leastHelpfulTraining || "",
        survey.whatWouldYouChange || "",
        survey.relationshipMapName || "",
        survey.willTrain411 || "",
        Array.isArray(survey.partnershipInterests) ? survey.partnershipInterests.join(", ") : "",
        Array.isArray(survey.prayerUpdateSignups)
          ? survey.prayerUpdateSignups.map(s => {
              if (typeof s === "object" && s !== null) {
                return s.email ? `${s.name || ""} <${s.email}>` : (s.name || "");
              }
              return s;
            }).join("; ")
          : "",
        Array.isArray(survey.financialPartnershipInterests) ? survey.financialPartnershipInterests.join(", ") : "",
        survey.anythingElse || "",
      ];

      async function appendToSheet(sheetId, label) {
        try {
          console.log("Attempting append to " + label + " sheet:", sheetId);
          const existing = await sheets.spreadsheets.values.get({
            spreadsheetId: sheetId,
            range: tab + "!A1",
          });
          if (!existing.data.values || existing.data.values.length === 0) {
            const headers = [
              "Date", "Week Name", "City", "Code Word", "Name", "Email",
              "Did Pre-Trip", "Pre-Trip Improvements", "Gospel Shares",
              "Most Helpful Training", "Least Helpful Training", "What Would You Change",
              "Relationship Map Name", "Will Train 411", "Partnership Interests",
              "Prayer Update Signups", "Financial Partnership Interests", "Anything Else",
            ];
            await sheets.spreadsheets.values.append({
              spreadsheetId: sheetId,
              range: tab + "!A1",
              valueInputOption: "RAW",
              insertDataOption: "INSERT_ROWS",
              requestBody: { values: [headers] },
            });
            console.log("Header row inserted into " + label + " sheet");
          }
          await sheets.spreadsheets.values.append({
            spreadsheetId: sheetId,
            range: tab + "!A1",
            valueInputOption: "RAW",
            insertDataOption: "INSERT_ROWS",
            requestBody: { values: [row] },
          });
          console.log("Row appended to " + label + " sheet (" + sheetId + ")");
        } catch (sheetErr) {
          console.error("ERROR appending to " + label + " sheet (" + sheetId + "):", sheetErr.message);
          console.error("Full error:", JSON.stringify(sheetErr));
        }
      }

      if (leaderSheetId) {
        await appendToSheet(leaderSheetId, "leader");
      } else {
        console.warn("User " + leaderId + " has no sheetId set - skipping leader sheet");
      }

      await appendToSheet(MASTER_SHEET_ID.value(), "master");
      console.log("onSurveyCreated completed successfully");

    } catch (err) {
      console.error("FATAL ERROR in onSurveyCreated:", err.message);
      console.error("Stack:", err.stack);
    }
  }
);
