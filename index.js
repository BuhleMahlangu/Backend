const express = require('express');
const bodyParser = require('body-parser');
const itemsRoutes = require('./routes/items'); // Adjust based on your actual setup
const oracledb = require('oracledb'); // Oracle DB driver
const cors = require('cors'); // CORS for Cross-Origin Resource Sharing
const bcrypt = require('bcrypt'); // To hash passwords
const multer = require('multer'); // Middleware for handling file uploads
const path = require('path'); // For handling file paths
const cloudinary = require('cloudinary').v2; // Cloudinary for image uploads
const QRCode = require('qrcode'); // Import QR code library
const nodemailer = require('nodemailer'); // Import Nodemailer for sending emails
require('dotenv').config(); // Load environment variables

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors()); // Enable CORS for cross-origin requests
app.use(bodyParser.json()); // Parse JSON payloads
app.use('/api/items', itemsRoutes); // Use item routes

// Setup multer for file storage
const storage = multer.diskStorage({
    destination: path.join(__dirname, 'uploads'), // Ensure this directory exists
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname)); // Append timestamp to filename
    }
});

const upload = multer({ 
    storage: storage,
    fileFilter: (req, file, cb) => {
        // Accept only images
        if (!file.mimetype.startsWith('image/')) {
            return cb(new Error('Only image files are allowed!'), false);
        }
        cb(null, true);
    }
});

// Configure Cloudinary
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Log configuration to verify
console.log("Cloudinary Config:", {
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Database connection configuration
const dbConfig = {
    user: process.env.DB_USER || 'hr',
    password: process.env.DB_PASSWORD || 'cmpg321',
    connectString: process.env.DB_CONNECTION_STRING || 'localhost:1521/XE'
};

// Test database connection endpoint
app.get('/api/test-db-connection', async (req, res) => {
    let connection;
    try {
        connection = await oracledb.getConnection(dbConfig);
        console.log('Database connected successfully');
        res.status(200).json({ message: 'Database connection successful' });
    } catch (err) {
        console.error('Database connection error:', err);
        res.status(500).json({ error: 'Database connection failed', details: err.message });
    } finally {
        if (connection) {
            try {
                await connection.close();
            } catch (closeErr) {
                console.error('Error closing connection', closeErr);
            }
        }
    }
});

// Fetch user information endpoint
app.get('/api/user', async (req, res) => {
    const userId = req.user?.id; // Retrieve user ID, ensure req.user exists
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    let connection;
    try {
        connection = await oracledb.getConnection(dbConfig);
        const result = await connection.execute(`SELECT * FROM USERS WHERE USER_ID = :userId`, [userId]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        const user = {
            id: result.rows[0][0],
            username: result.rows[0][1],
            email: result.rows[0][2],
        };

        res.status(200).json(user);
    } catch (err) {
        console.error('Error fetching user:', err);
        res.status(500).json({ error: 'Internal Server Error', details: err.message });
    } finally {
        if (connection) {
            try {
                await connection.close();
            } catch (closeErr) {
                console.error('Error closing connection', closeErr);
            }
        }
    }
});

// Fetch RSVPed events endpoint
app.get('/api/rsvps', async (req, res) => {
    const userId = req.user?.id; // Retrieve user ID
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    let connection;
    try {
        connection = await oracledb.getConnection(dbConfig);
        const result = await connection.execute(`SELECT * FROM RSVPS WHERE USER_ID = :userId`, [userId]);

        const rsvps = result.rows.map(row => ({
            eventId: row[0],
            title: row[1],
            date: row[2],
        }));

        res.status(200).json(rsvps);
    } catch (err) {
        console.error('Error fetching RSVPs:', err);
        res.status(500).json({ error: 'Internal Server Error', details: err.message });
    } finally {
        if (connection) {
            try {
                await connection.close();
            } catch (closeErr) {
                console.error('Error closing connection', closeErr);
            }
        }
    }
});

// Insert Event Function
const insertEvent = async (title, description, eventDate, location, poster, price) => {
    let connection;
    try {
        connection = await oracledb.getConnection(dbConfig);
        const result = await connection.execute(
            `INSERT INTO EVENTS (EVENT_ID, TITLE, DESCRIPTION, EVENT_DATE, LOCATION, CREATED_AT, POSTER, PRICE, RSVP_COUNT) 
             VALUES (event_id_seq.NEXTVAL, :title, :description, TO_DATE(:eventDate, 'YYYY-MM-DD'), :location, SYSTIMESTAMP, :poster, :price, 0)`,
            {
                title,
                description,
                eventDate, // Ensure it's 'YYYY-MM-DD'
                location,
                poster,
                price // New price parameter
            },
            { autoCommit: true }
        );
        return result;
    } catch (err) {
        console.error('Insert Event Error:', err);
        throw new Error('Error inserting event: ' + err.message);
    } finally {
        if (connection) {
            try {
                await connection.close();
            } catch (closeErr) {
                console.error('Error closing connection', closeErr);
            }
        }
    }
};

// API endpoint for uploading event details and poster
app.post('/api/admin/upload-event', upload.single('poster'), async (req, res) => {
    const { title, description, location, eventDate, price } = req.body;

    // Ensure you have all required fields
    if (!title || !description || !location || !eventDate || !price || !req.file) {
        return res.status(400).json({ error: 'All fields are required' });
    }

    try {
        // Upload the image to Cloudinary
        const result = await cloudinary.uploader.upload(req.file.path);
        console.log("Image uploaded to Cloudinary:", result.secure_url);
        
        await insertEvent(title, description, eventDate, location, result.secure_url, price);
        res.status(201).json({ message: 'Event created successfully' });
    } catch (err) {
        console.error('Error uploading event:', err);
        res.status(500).json({ error: 'Error uploading event', details: err.message });
    }
});

// API endpoint to get all events
app.get('/api/events', async (req, res) => {
    let connection;
    try {
        connection = await oracledb.getConnection(dbConfig);
        const result = await connection.execute(`SELECT * FROM EVENTS ORDER BY CREATED_AT DESC`);

        const events = result.rows.map(row => ({
            eventId: row[0],
            title: row[1],
            description: row[2],
            eventDate: row[3],
            location: row[4],
            createdAt: row[5],
            poster: row[6],
            price: row[7],
            rsvpCount: row[8]
        }));

        res.status(200).json(events);
    } catch (err) {
        console.error('Error fetching events:', err);
        res.status(500).json({ error: 'Failed to fetch events', details: err.message });
    } finally {
        if (connection) {
            try {
                await connection.close();
            } catch (closeErr) {
                console.error('Error closing connection', closeErr);
            }
        }
    }
});

// API endpoint for RSVPing to an event
app.post('/api/events/:eventId/rsvp', async (req, res) => {
    const eventId = req.params.eventId;

    let connection;
    try {
        connection = await oracledb.getConnection(dbConfig);
        
        // Increment RSVP count for the event
        await connection.execute(
            `UPDATE EVENTS SET RSVP_COUNT = NVL(RSVP_COUNT, 0) + 1 WHERE EVENT_ID = :eventId`,
            [eventId],
            { autoCommit: true }
        );

        res.status(200).json({ message: 'RSVP successful!', eventId });
    } catch (err) {
        console.error('RSVP error:', err);
        res.status(500).json({ error: 'Error during RSVP', details: err.message });
    } finally {
        if (connection) {
            try {
                await connection.close();
            } catch (closeErr) {
                console.error('Error closing connection', closeErr);
            }
        }
    }
});

// API endpoint for generating a QR code for an RSVP
app.get('/api/events/:eventId/qrcode', async (req, res) => {
    const eventId = req.params.eventId;
    const ticketData = {
        eventId: eventId,
        message: 'Your RSVP is confirmed!',
    };

    try {
        const qrCode = await QRCode.toDataURL(JSON.stringify(ticketData)); // Generates a QR code as a Data URL
        res.status(200).json({ qrCode });
    } catch (error) {
        console.error('Error generating QR code:', error);
        res.status(500).json({ error: 'Failed to generate QR Code', details: error.message });
    }
});

// Payment endpoint
app.post('/api/pay', async (req, res) => {
    const { eventId, paymentData, email } = req.body;

    let transporter;
    try {
        // After payment is successful, send an email confirmation
        transporter = nodemailer.createTransport({
            service: 'Gmail', // Example: Use Gmail, update accordingly
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS,
            },
        });

        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: email,
            subject: 'Payment Confirmation',
            text: `Thank you for your payment for event ${eventId}!`,
        };

        await transporter.sendMail(mailOptions);
        
        // Generate the ticket with QR code included
        const ticketData = {
            eventId: eventId,
            qrCode: await QRCode.toDataURL(`Event ID: ${eventId}`),
            message: 'Your RSVP is confirmed!',
        };

        res.status(200).json({ ticket: ticketData });
    } catch (error) {
        console.error('Payment processing error:', error);
        res.status(500).json({ error: 'Payment processing failed', details: error.message });
    }
});

// API endpoint for registering a user
app.post('/api/register', async (req, res) => {
    const { username, password, email } = req.body;

    let connection;
    try {
        connection = await oracledb.getConnection(dbConfig);
        
        const existingUser = await connection.execute(
            `SELECT * FROM USERS WHERE username = :username OR email = :email`,
            [username, email]
        );

        if (existingUser.rows.length > 0) {
            return res.status(400).json({ error: 'Username or email already exists.' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const result = await connection.execute(
            `INSERT INTO USERS (USER_ID, username, password, email) VALUES (user_id_seq.NEXTVAL, :username, :password, :email)`,
            [username, hashedPassword, email],
            { autoCommit: true }
        );

        res.status(201).json({ message: 'User created successfully', userId: result.lastRowId });
    } catch (err) {
        console.error('Database error:', err);
        res.status(500).json({ error: 'Error creating user', details: err.message });
    } finally {
        if (connection) {
            try {
                await connection.close();
            } catch (closeErr) {
                console.error('Error closing connection', closeErr);
            }
        }
    }
});

// API endpoint for logging in a user
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;

    let connection;
    try {
        connection = await oracledb.getConnection(dbConfig);
        
        const result = await connection.execute(
            `SELECT * FROM USERS WHERE username = :username`,
            [username]
        );

        if (result.rows.length === 0) {
            return res.status(400).json({ error: 'Invalid credentials' });
        }

        const user = result.rows[0];
        const passwordMatch = await bcrypt.compare(password, user[2]);

        if (!passwordMatch) {
            return res.status(400).json({ error: 'Invalid credentials' });
        }

        res.status(200).json({ 
            message: 'Login successful', 
            user: { id: user[0], username: user[1], email: user[3] }, 
            canSignUpAsAdmin: true // Indicate they can sign up as an admin
        });
    } catch (err) {
        console.error('Database error:', err);
        res.status(500).json({ error: 'Login error', details: err.message });
    } finally {
        if (connection) {
            try {
                await connection.close();
            } catch (closeErr) {
                console.error('Error closing connection', closeErr);
            }
        }
    }
});

// API endpoint for logging in an admin
app.post('/api/admin/login', async (req, res) => {
    const { username, password } = req.body;

    let connection;
    try {
        connection = await oracledb.getConnection(dbConfig);

        const result = await connection.execute(
            `SELECT * FROM ADMIN WHERE USERNAME = :username`,
            [username]
        );

        if (result.rows.length === 0) {
            return res.status(400).json({ error: 'Invalid credentials' });
        }

        const admin = result.rows[0];
        const passwordMatch = await bcrypt.compare(password, admin[2]);

        if (!passwordMatch) {
            return res.status(400).json({ error: 'Invalid credentials' });
        }

        res.status(200).json({ message: 'Admin login successful', admin: { id: admin[0], username: admin[1] } });
    } catch (err) {
        console.error('Database error:', err); 
        res.status(500).json({ error: 'Login error', details: err.message });
    } finally {
        if (connection) {
            try {
                await connection.close();
            } catch (closeErr) {
                console.error('Error closing connection', closeErr);
            }
        }
    }
});

// API endpoint for registering an admin
app.post('/api/admin/register', async (req, res) => {
    const { username, password, email } = req.body;

    let connection;
    try {
        connection = await oracledb.getConnection(dbConfig);
        
        const existingAdmin = await connection.execute(
            `SELECT * FROM ADMIN WHERE USERNAME = :username OR EMAIL = :email`,
            [username, email]
        );

        if (existingAdmin.rows.length > 0) {
            return res.status(400).json({ error: 'Username or email already exists.' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const result = await connection.execute(
            `INSERT INTO ADMIN (ADMIN_ID, USERNAME, PASSWORD, EMAIL) VALUES (admin_id_seq.NEXTVAL, :username, :password, :email)`,
            [username, hashedPassword, email],
            { autoCommit: true }
        );

        res.status(201).json({ message: 'Admin created successfully', adminId: result.lastRowId });
    } catch (err) {
        console.error('Database error:', err);
        res.status(500).json({ error: 'Error creating admin', details: err.message });
    } finally {
        if (connection) {
            try {
                await connection.close();
            } catch (closeErr) {
                console.error('Error closing connection', closeErr);
            }
        }
    }
});

// API endpoint for deleting an event
app.delete('/api/events/:eventId', async (req, res) => {
    const eventId = req.params.eventId;

    let connection;
    try {
        connection = await oracledb.getConnection(dbConfig);

        // Execute the delete command
        await connection.execute(
            `DELETE FROM EVENTS WHERE EVENT_ID = :eventId`,
            [eventId],
            { autoCommit: true }
        );

        res.status(200).json({ message: 'Event deleted successfully!' });
    } catch (err) {
        console.error('Delete event error:', err);
        res.status(500).json({ error: 'Error deleting event', details: err.message });
    } finally {
        if (connection) {
            try {
                await connection.close();
            } catch (closeErr) {
                console.error('Error closing connection', closeErr);
            }
        }
    }
});

// Start the server
app.listen(port, () => {
    console.log(`API server running at http://localhost:${port}`);
});