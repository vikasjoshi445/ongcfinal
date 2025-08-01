const { Sequelize } = require('sequelize');
require('dotenv').config();

// SQL Database Configuration
const sequelize = new Sequelize(
  process.env.SQL_DATABASE || 'ongc_auth_db',
  process.env.SQL_USER || 'root',
  process.env.SQL_PASSWORD || '',
  {
    host: process.env.SQL_HOST || 'localhost',
    port: process.env.SQL_PORT || 3306,
    dialect: 'mysql',
    logging: process.env.NODE_ENV === 'development' ? console.log : false,
    pool: {
      max: 5,
      min: 0,
      acquire: 30000,
      idle: 10000
    },
    define: {
      timestamps: true,
      underscored: true
    }
  }
);

// Test the connection
const testConnection = async () => {
  try {
    console.log('🔍 Testing SQL database connection...');
    console.log(`📊 Database: ${process.env.SQL_DATABASE || 'ongc_auth_db'}`);
    console.log(`👤 User: ${process.env.SQL_USER || 'root'}`);
    console.log(`🌐 Host: ${process.env.SQL_HOST || 'localhost'}:${process.env.SQL_PORT || 3306}`);
    
    await sequelize.authenticate();
    console.log('✅ SQL Database connection established successfully.');
    return true;
  } catch (error) {
    console.error('❌ Unable to connect to SQL database:', error.message);
    console.error('💡 Please ensure MySQL server is running and credentials are correct.');
    return false;
  }
};

// Create database if it doesn't exist
const createDatabaseIfNotExists = async () => {
  try {
    console.log('🗄️  Checking if database exists...');
    
    // Connect without specifying database
    const tempSequelize = new Sequelize(
      process.env.SQL_HOST || 'localhost',
      process.env.SQL_USER || 'root',
      process.env.SQL_PASSWORD || '',
      {
        dialect: 'mysql',
        logging: false
      }
    );
    
    // Create database if it doesn't exist
    const databaseName = process.env.SQL_DATABASE || 'ongc_auth_db';
    await tempSequelize.query(`CREATE DATABASE IF NOT EXISTS \`${databaseName}\`;`);
    console.log(`✅ Database '${databaseName}' is ready.`);
    
    await tempSequelize.close();
    return true;
  } catch (error) {
    console.error('❌ Error creating database:', error.message);
    return false;
  }
};

// Sync database (create tables if they don't exist)
const syncDatabase = async () => {
  try {
    console.log('🔄 Synchronizing database schema...');
    await sequelize.sync({ alter: true });
    console.log('✅ SQL Database synchronized successfully.');
    return true;
  } catch (error) {
    console.error('❌ Error synchronizing SQL database:', error);
    return false;
  }
};

// Get database statistics
const getDatabaseStats = async () => {
  try {
    const userCount = await sequelize.models.User?.count() || 0;
    console.log(`📊 Database Statistics:`);
    console.log(`   👥 Users: ${userCount}`);
    return { users: userCount };
  } catch (error) {
    console.error('❌ Error getting database stats:', error);
    return { users: 0 };
  }
};

module.exports = {
  sequelize,
  testConnection,
  createDatabaseIfNotExists,
  syncDatabase,
  getDatabaseStats
}; 