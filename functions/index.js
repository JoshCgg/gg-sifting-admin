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

  // 1. Get the week doc to find the leader's UID
  const weekDoc = await admin.firestore().collection("weeks").doc(weekId).get();
  if (!weekDoc.exists) {
    console.warn("Week " + weekId + " not found - skipping");
    return;
  }
  const weekData = weekDoc.data();
  const leaderId = weekData.createdBy;

  // 2. Get the leader's user doc to find their Sheet ID
  const userDoc = await admin.firestore().collection("users").doc(leaderId).get();
  const leaderSheetId = userDoc.exists ? userDoc.data().sheetId : null;

  // 3. Authenticate with Google Sheets via service account
  const auth = new google.auth.GoogleAuth({
    keyFile: "./service-account.json",
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const sheets = google.sheets({ version: "v4", auth });

  // 4. Build the row (same for both sheets)
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

  // 5. Helper to append a row to a given sheet
  async function appendToSheet(sheetId, label) {
    const existing = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: "Sheet1!A1",
    });
    if (!existing.data.values || existing.data.values.length === 0) {
      const headers = ["Date", "Week Name", "City", "Code Word", "Name", "Phone", "Email", "Gospel Response", "Follow-Up?", "Notes"];
      await sheets.spreadsheets.values.append({
        spreadsheetId: sheetId,
        range: "Sheet1!A1",
        valueInputOption: "RAW",
        insertDataOption: "INSERT_ROWS",
        requestBody: { values: [headers] },
      });
      console.log("Header row inserted into " + label + " sheet (" + sheetId + ")");
    }
    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: "Sheet1!A1",
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [row] },
    });
    console.log("Row appended to " + label + " sheet (" + sheetId + ")");
  }

  // 6. Append to leader's sheet if they have one
  if (leaderSheetId) {
    await appendToSheet(leaderSheetId, "leader");
  } else {
    console.warn("User " + leaderId + " has no sheetId set - skipping leader sheet");
  }

  // 7. Always append to master sheet
  await appendToSheet(MASTER_SHEET_ID.value(), "master");
});