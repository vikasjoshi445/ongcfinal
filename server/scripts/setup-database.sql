-- ONGC Internship ATS - SQL Database Setup Script
-- This script creates the database and tables for user authentication

-- Create database if it doesn't exist
CREATE DATABASE IF NOT EXISTS ongc_auth_db;
USE ongc_auth_db;

-- Create users table
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  role ENUM('hr_manager', 'admin', 'viewer') DEFAULT 'hr_manager' NOT NULL,
  department VARCHAR(255),
  employee_id VARCHAR(50) UNIQUE,
  is_active BOOLEAN DEFAULT TRUE NOT NULL,
  last_login DATETIME,
  password_reset_token VARCHAR(255),
  password_reset_expires DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  INDEX idx_email (email),
  INDEX idx_role (role),
  INDEX idx_is_active (is_active)
);

-- Create default users (passwords will be hashed by the application)
INSERT IGNORE INTO users (email, password, name, role, department, employee_id, is_active) VALUES
('hr@ongc.co.in', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'HR Manager', 'hr_manager', 'Human Resources', 'HR001', TRUE),
('admin@ongc.co.in', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'System Administrator', 'admin', 'IT', 'IT001', TRUE),
('viewer@ongc.co.in', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'Data Viewer', 'viewer', 'HR', 'HR002', TRUE);

-- Show the created table structure
DESCRIBE users;

-- Show the default users
SELECT id, email, name, role, department, employee_id, is_active, created_at FROM users; 