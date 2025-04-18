const express = require("express");
const cors = require("cors");
const mysql = require("mysql2");
const bcrypt = require("bcrypt");
const saltRounds = 10;
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const app = express();
app.use(cors());
app.use(express.json());

const db = mysql.createConnection({
  host: "localhost",
  user: "root",
  password: "",
  database: "volmed_db",
});

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const patientId = req.params.id;
    const uploadPath = `./uploads/patients/${patientId}`;

    // Create directory if it doesn't exist
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const originalname = file.originalname;
    const ext = path.extname(originalname);
    const basename = path.basename(originalname, ext);

    // Remove special characters but keep the original structure
    const safeName = basename.replace(/[^a-zA-Z0-9-_]/g, "") + ext;

    // Check if file exists and add suffix if needed
    const fullPath = `./uploads/patients/${req.params.id}/${safeName}`;

    if (fs.existsSync(fullPath)) {
      const timestamp = Date.now();
      cb(null, `${basename}-${timestamp}${ext}`);
    } else {
      cb(null, safeName);
    }
  },
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const allowedTypes = ["application/pdf", "image/jpeg", "image/png"];
    if (!allowedTypes.includes(file.mimetype)) {
      return cb(new Error("Only PDF, JPEG and PNG files are allowed"));
    }
    cb(null, true);
  },
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
});

db.connect((err) => {
  if (err) {
    console.error("Database connection failed: " + err.stack);
    return;
  }
  console.log("Connected to database.");
});

// Amount of ID's in DB
app.get("/api/patient-count", (req, res) => {
  db.query("SELECT COUNT(id) AS count FROM patients", (err, results) => {
    if (err) {
      console.error("Database error:", err);
      return res.status(500).json({ error: "Database error" });
    }
    res.json({
      count: results[0].count,
    });
  });
});

// Get all patients
app.get("/api/patients", (req, res) => {
  db.query("SELECT * FROM patients", (err, results) => {
    if (err) throw err;
    res.json(results);
  });
});

// Add a new patient
app.post("/api/patients", upload.array("files"), async (req, res) => {
  try {
    const newPatient = req.body;
    const patientResults = await db.query(
      "INSERT INTO patients SET ?",
      newPatient
    );
    const patientId = patientResults.insertId;

    // Then handle file moves if any
    if (req.files && req.files.length > 0) {
      const tempPath = `./uploads/patients/temp`;
      const finalPath = `./uploads/patients/${patientId}`;

      // Create final directory
      if (!fs.existsSync(finalPath)) {
        fs.mkdirSync(finalPath, { recursive: true });
      }

      // Move files from temp to final location
      for (const file of req.files) {
        const oldPath = path.join(tempPath, file.filename);
        const newPath = path.join(finalPath, file.filename);
        fs.renameSync(oldPath, newPath);
      }
    }

    // Return the created patient
    const [patient] = await db.query("SELECT * FROM patients WHERE id = ?", [
      patientId,
    ]);
    res.status(201).json(patient[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
});

// Update a patient
app.put("/api/patients/:id", (req, res) => {
  const { id } = req.params;
  const editPatient = req.body;

  db.query(
    "UPDATE patients SET ? WHERE id = ?",
    [editPatient, id],
    (err, results) => {
      if (err) {
        console.error(err);
        return res.status(500).json({
          success: false,
          error: "Database error",
          message: err.message,
        });
      }

      if (results.affectedRows === 0) {
        return res.status(404).json({
          success: false,
          error: "Patient not found",
        });
      }

      // Get the updated patient
      db.query(
        "SELECT * FROM patients WHERE id = ?",
        [id],
        (err, patientResults) => {
          if (err || patientResults.length === 0) {
            console.error(err || "Patient not found after update");
            return res.json({
              success: true,
              message: "Patient updated but could not retrieve details",
              patient: editPatient, // Return what we have
            });
          }

          res.json({
            success: true,
            message: "Patient updated successfully",
            patient: patientResults[0],
          });
        }
      );
    }
  );
});

// Delete a patient
app.delete("/api/patients/:id", (req, res) => {
  const { id } = req.params;
  db.query("DELETE FROM patients WHERE id = ?", id, (err, results) => {
    if (err) {
      console.error(err);
      return res.status(500).json({
        success: false,
        error: "Database error",
        message: err.message,
      });
    }

    if (results.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        error: "Patient not found",
      });
    }

    res.json({
      success: true,
      message: "Patient deleted successfully",
      deletedId: id,
    });
  });
});

app.get("/api/patients/:id", (req, res) => {
  const { id } = req.params;

  // Validate ID is a number
  if (isNaN(id)) {
    return res.status(400).json({ error: "Invalid patient ID format" });
  }

  db.query("SELECT * FROM patients WHERE id = ?", id, (err, results) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: "Database error" });
    }
    if (results.length === 0) {
      return res.status(404).json({ error: "Patient not found" });
    }
    res.json(results[0]);
  });
});

app.post("/api/patients/:id/upload", upload.single("file"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  res.json({
    filename: (req, file, cb) => {
      const originalname = file.originalname;
      const ext = path.extname(originalname);
      const basename = path.basename(originalname, ext);

      const safeName = basename.replace(/[^a-zA-Z0-9-_]/g, "") + ext;
      const fullPath = `./uploads/patients/${req.params.id}/${safeName}`;

      if (fs.existsSync(fullPath)) {
        let counter = 1;
        let newName = `${basename} (${counter})${ext}`;

        while (
          fs.existsSync(`./uploads/patients/${req.params.id}/${newName}`)
        ) {
          counter++;
          newName = `${basename} (${counter})${ext}`;
        }

        cb(null, newName);
      } else {
        cb(null, safeName);
      }
    },
  });
});

app.get("/api/patients/:id/files", (req, res) => {
  const patientId = req.params.id;
  const uploadPath = `./uploads/patients/${patientId}`;

  if (!fs.existsSync(uploadPath)) {
    return res.json([]);
  }

  fs.readdir(uploadPath, (err, files) => {
    if (err) {
      return res.status(500).json({ error: "Error reading directory" });
    }

    const fileList = files.map((file) => {
      const stat = fs.statSync(path.join(uploadPath, file));
      return {
        filename: file,
        originalname: file,
        path: `/uploads/patients/${patientId}/${file}`,
        size: stat.size,
      };
    });

    res.json(fileList);
  });
});

app.use("/uploads", express.static("uploads"));
app.listen(5000, () => {
  console.log("Server is running on port 5000");
});
