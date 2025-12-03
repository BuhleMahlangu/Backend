const express = require('express');
const bodyParser = require('body-parser');
const itemsRoutes = require('./routes/items'); // Assuming you have items routes defined
const oracledb = require('oracledb'); // Oracle DB driver
const cors = require('cors'); // CORS for Cross-Origin Resource Sharing
const bcrypt = require('bcrypt'); // To hash passwords
const multer = require('multer');
const path = require('path');

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

const upload = multer({ storage: storage });

// Database connection configuration
const dbConfig = {
    user: 'hr',                         
    password: 'cmpg321',                
    connectString: 'localhost:1521/XE'  
};

// Test database connection endpoint
app.get('/api/test-db-connection', async (req, res) => {
    try {
        const connection = await oracledb.getConnection(dbConfig);
        console.log('Database connected successfully');
        await connection.close();
        res.status(200).json({ message: 'Database connection successful' });
    } catch (err) {
        console.error('Database connection error:', err);
        res.status(500).json({ error: 'Database connection failed', details: err.message });
    }
});

// Insert Event Function
const insertEvent = async (title, description, eventDate, location, poster) => {
    try {
        const connection = await oracledb.getConnection(dbConfig);

        // Log the event date to verify its format
        console.log("Event Date:", eventDate); // Should output in 'YYYY-MM-DD' format
        
        // Ensure date format is compatible with TO_DATE
        const result = await connection.execute(
            `INSERT INTO EVENTS (EVENT_ID, TITLE, DESCRIPTION, EVENT_DATE, LOCATION, CREATED_AT, POSTER) 
             VALUES (event_id_seq.NEXTVAL, :title, :description, TO_DATE(:eventDate, 'YYYY-MM-DD'), :location, SYSTIMESTAMP, :poster)`,
            {
                title: title,
                description: description,
                eventDate: eventDate, // Ensure it's 'YYYY-MM-DD'
                location: location,
                poster: poster
            },
            { autoCommit: true }
        );
        await connection.close();
        return result;
    } catch (err) {
        console.error('Insert Event Error:', err);
        throw new Error('Error inserting event: ' + err.message);
    }
};

// API endpoint for uploading event details
app.post('/api/admin/upload-event', upload.single('poster'), async (req, res) => {
    const { title, description, location } = req.body; // Add title to body

    // Ensure you have all required fields
    if (!title || !description || !location || !req.file) {
        return res.status(400).json({ error: 'All fields are required' });
    }

    console.log('Event data received:', { title, description, location, poster: req.file.filename });

    try {
        const eventId = await insertEvent(title, description, req.body.eventDate, location, req.file.filename); // Send correct eventDate here
        res.status(201).json({ message: 'Event created successfully', eventId: eventId });
    } catch (err) {
        console.error('Database error:', err);
        res.status(500).json({ error: 'Error uploading event', details: err.message });
    }
});

// API endpoint to get all events
app.get('/api/events', async (req, res) => {
    try {
        const connection = await oracledb.getConnection(dbConfig);
        const result = await connection.execute(`SELECT * FROM EVENTS ORDER BY CREATED_AT DESC`); // Order by creation date
        await connection.close();
        
        // Format the result as needed
        const events = result.rows.map(row => ({
            eventId: row[0],
            title: row[1],
            description: row[2],
            eventDate: row[3],
            location: row[4],
            createdAt: row[5],
            poster: row[6]
        }));

        res.status(200).json(events);
    } catch (err) {
        console.error('Error fetching events:', err);
        res.status(500).json({ error: 'Failed to fetch events', details: err.message });
    }
});

// API endpoint for registering a user
app.post('/api/register', async (req, res) => {
    const { username, password, email } = req.body;

    console.log('Registration data received:', { username, email });

    try {
        const connection = await oracledb.getConnection(dbConfig);
        
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
        await connection.close();
    } catch (err) {
        console.error('Database error:', err);
        res.status(500).json({ error: 'Error creating user', details: err.message });
    }
});

// API endpoint for logging in a user
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;

    console.log('Login data received:', { username });

    try {
        const connection = await oracledb.getConnection(dbConfig);
        
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
            user,
            canSignUpAsAdmin: true // Indicate they can sign up as an admin
        });
        await connection.close();
    } catch (err) {
        console.error('Database error:', err); 
        res.status(500).json({ error: 'Login error', details: err.message });
    }
});

// API endpoint for logging in an admin
app.post('/api/admin/login', async (req, res) => {
    const { username, password } = req.body;

    try {
        const connection = await oracledb.getConnection(dbConfig);

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
        await connection.close();
    } catch (err) {
        console.error('Database error:', err); 
        res.status(500).json({ error: 'Login error', details: err.message });
    }
});

// API endpoint for registering an admin
app.post('/api/admin/register', async (req, res) => {
    const { username, password, email } = req.body;

    console.log('Admin registration data received:', { username, email });

    try {
        const connection = await oracledb.getConnection(dbConfig);
        
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
        await connection.close();
    } catch (err) {
        console.error('Database error:', err);
        res.status(500).json({ error: 'Error creating admin', details: err.message });
    }
});

// Start the server
app.listen(port, () => {
    console.log(`API server running at http://localhost:${port}`);
});