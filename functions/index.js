const { setGlobalOptions } = require("firebase-functions");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { defineString } = require("firebase-functions/params");
const { google } = require("googleapis");
const admin = require("firebase-admin");

admin.initializeApp();
setGlobalOptions({ maxInstances: 10 });

const MASTER_SHEET_ID = defineString("MASTER_SHEET_ID");

exports.onContactCreated = onDocumentCreated(
  { document: "contacts/{contactId}", region: "us-central1" },
  async (event) => {
  const contact = event.data.data();
  const weekId = contact.weekId;

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

  const userDoc = await admin.firestore().collection("users").doc(leaderId).get();
  const leaderSheetId = userDoc.exists ? userDoc.data().sheetId : null;

  const auth = new google.auth.GoogleAuth({
    keyFile: "./service-account.json",
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const sheets = google.sheets({ version: "v4", auth });

  const tab = "Followup Contacts";
  const row = [
    contact.clientDate || "",
    weekData.name || "",
    weekData.city || "",
    contact.codeWord || "",
    contact.name || "",
    contact.phone || "",
    "",
    contact.gospelResponse || "",
    contact.followUpRequested ? "Yes" : "No",
    contact.notes || "",
  ];

  async function appendToSheet(sheetId, label) {
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
      console.log("Header row inserted into " + label + " sheet (" + sheetId + ")");
    }
    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: tab + "!A1",
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [row] },
    });
    console.log("Row appended to " + label + " sheet (" + sheetId + ")");
  }

  if (leaderSheetId) {
    await appendToSheet(leaderSheetId, "leader");
  } else {
    console.warn("User " + leaderId + " has no sheetId set - skipping leader sheet");
  }

  await appendToSheet(MASTER_SHEET_ID.value(), "master");
});

exports.onSurveyCreated = onDocumentCreated(
  { document: "surveyResponses/{surveyId}", region: "us-central1" },
  async (event) => {
  const survey = event.data.data();
  const weekId = survey.weekId;

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

  const userDoc = await admin.firestore().collection("users").doc(leaderId).get();
  const leaderSheetId = userDoc.exists ? userDoc.data().sheetId : null;

  const auth = new google.auth.GoogleAuth({
    keyFile: "./service-account.json",
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const sheets = google.sheets({ version: "v4", auth });

  const tab = "Post-Trip Survey";
  const row = [
    survey.clientDate || "",
    weekData.name || "",
    weekData.city || "",
    survey.codeWord || "",
    survey.name || "",
    survey.email || "",
    survey.didPretrip || "",
    survey.gospelShareCount || "",
    survey.mostHelpfulTraining || "",
    survey.leastHelpfulTraining || "",
    survey.whatWouldYouChange || "",
    survey.relationshipMapName || "",
    survey.willTrain411 || "",
    Array.isArray(survey.partnershipInterests) ? survey.partnershipInterests.join(" / ") : "",
    Array.isArray(survey.prayerUpdateSignups) ? survey.prayerUpdateSignups.map(s => s.name || s).join(" / ") : "",
    Array.isArray(survey.financialPartnershipInterests) ? survey.financialPartnershipInterests.map(s => s.name || s).join(" / ") : "",
    survey.anythingElse || "",
  ];

  async function appendToSheet(sheetId, label) {
    const existing = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: tab + "!A1",
    });
    if (!existing.data.values || existing.data.values.length === 0) {
      const headers = [
        "Date", "Week Name", "City", "Code Word", "Name", "Email",
        "Did Pretrip", "Gospel Share Count", "Most Helpful Training",
        "Least Helpful Training", "What Would You Change", "Relationship Map",
        "Will Train 411", "Partnership Interests", "Prayer Update Signups",
        "Financial Partnership Interests", "Anything Else",
      ];
      await sheets.spreadsheets.values.append({
        spreadsheetId: sheetId,
        range: tab + "!A1",
        valueInputOption: "RAW",
        insertDataOption: "INSERT_ROWS",
        requestBody: { values: [headers] },
      });
      console.log("Header row inserted into " + label + " sheet (" + sheetId + ")");
    }
    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: tab + "!A1",
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [row] },
    });
    console.log("Row appended to " + label + " sheet (" + sheetId + ")");
  }

  if (leaderSheetId) {
    await appendToSheet(leaderSheetId, "leader");
  } else {
    console.warn("User " + leaderId + " has no sheetId set - skipping leader sheet");
  }

  await appendToSheet(MASTER_SHEET_ID.value(), "master");
});
