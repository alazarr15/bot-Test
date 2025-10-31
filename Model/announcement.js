// models/announcement.js

const mongoose = require("mongoose");

const announcementSchema = new mongoose.Schema({
    // The Telegram Chat ID of the user the message was sent to
    userId: {
        type: Number,
        required: true,
        index: true // Indexing this field for faster lookups
    },
    // The unique ID of the message returned by Telegram's API
    messageId: {
        type: Number,
        required: true,
        unique: true, // This should be a unique ID
        index: true
    },
    // The full content of the message that was sent
    messageContent: {
        type: String,
        required: true
    },
    // The date and time the message was sent
    sentAt: {
        type: Date,
        default: Date.now
    }
});

// Create the model
const Announcement = mongoose.model("Announcement", announcementSchema);

// Export the model for use in other files
module.exports = Announcement;