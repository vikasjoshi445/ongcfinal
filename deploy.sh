#!/bin/bash

# ONGC Internship ATS - Deployment Script
# ======================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if Docker is installed
check_docker() {
    if ! command -v docker &> /dev/null; then
        print_error "Docker is not installed. Please install Docker first."
        exit 1
    fi
    
    if ! command -v docker-compose &> /dev/null; then
        print_error "Docker Compose is not installed. Please install Docker Compose first."
        exit 1
    fi
    
    print_status "Docker and Docker Compose are installed."
}

# Check if .env file exists
check_env_file() {
    if [ ! -f ".env" ]; then
        print_warning ".env file not found. Creating from template..."
        if [ -f "server/env.production" ]; then
            cp server/env.production .env
            print_status "Created .env file from production template."
            print_warning "Please edit .env file with your production credentials before continuing."
            exit 1
        else
            print_error "No environment template found. Please create .env file manually."
            exit 1
        fi
    fi
    
    print_status ".env file found."
}

# Validate environment variables
validate_env() {
    print_status "Validating environment variables..."
    
    required_vars=(
        "JWT_SECRET"
        "SQL_PASSWORD"
        "EMAIL_USER"
        "EMAIL_PASS"
    )
    
    for var in "${required_vars[@]}"; do
        if [ -z "${!var}" ]; then
            print_error "Required environment variable $var is not set."
            exit 1
        fi
    done
    
    print_status "Environment variables validated."
}

# Build and deploy
deploy() {
    print_status "Starting deployment..."
    
    # Stop existing containers
    print_status "Stopping existing containers..."
    docker-compose down --remove-orphans
    
    # Build images
    print_status "Building Docker images..."
    docker-compose build --no-cache
    
    # Start services
    print_status "Starting services..."
    docker-compose up -d
    
    # Wait for services to be healthy
    print_status "Waiting for services to be healthy..."
    sleep 30
    
    # Check service health
    print_status "Checking service health..."
    
    # Check MySQL
    if docker-compose exec -T mysql mysqladmin ping -h localhost --silent; then
        print_status "MySQL is healthy."
    else
        print_error "MySQL is not healthy."
        exit 1
    fi
    
    # Check MongoDB
    if docker-compose exec -T mongodb mongosh --eval "db.adminCommand('ping')" --quiet; then
        print_status "MongoDB is healthy."
    else
        print_error "MongoDB is not healthy."
        exit 1
    fi
    
    # Check Server
    if curl -f http://localhost:3001/api/health > /dev/null 2>&1; then
        print_status "Server is healthy."
    else
        print_error "Server is not healthy."
        exit 1
    fi
    
    print_status "Deployment completed successfully!"
    print_status "Application is available at:"
    echo "  - Frontend: http://localhost:3000"
    echo "  - Backend API: http://localhost:3001"
    echo "  - Health Check: http://localhost:3001/api/health"
}

# Backup function
backup() {
    print_status "Creating backup..."
    
    timestamp=$(date +%Y%m%d_%H%M%S)
    backup_dir="backup_$timestamp"
    
    mkdir -p "$backup_dir"
    
    # Backup MySQL data
    docker-compose exec -T mysql mysqldump -u root -p"${MYSQL_ROOT_PASSWORD:-rootpassword}" --all-databases > "$backup_dir/mysql_backup.sql"
    
    # Backup MongoDB data
    docker-compose exec -T mongodb mongodump --out /tmp/backup
    docker cp ongc-mongodb:/tmp/backup "$backup_dir/mongodb_backup"
    
    # Backup uploads
    if [ -d "uploads" ]; then
        cp -r uploads "$backup_dir/"
    fi
    
    print_status "Backup created in $backup_dir"
}

# Rollback function
rollback() {
    if [ -z "$1" ]; then
        print_error "Please specify backup directory for rollback."
        exit 1
    fi
    
    backup_dir="$1"
    
    if [ ! -d "$backup_dir" ]; then
        print_error "Backup directory $backup_dir not found."
        exit 1
    fi
    
    print_status "Rolling back to $backup_dir..."
    
    # Stop services
    docker-compose down
    
    # Restore MySQL
    if [ -f "$backup_dir/mysql_backup.sql" ]; then
        docker-compose up -d mysql
        sleep 10
        docker-compose exec -T mysql mysql -u root -p"${MYSQL_ROOT_PASSWORD:-rootpassword}" < "$backup_dir/mysql_backup.sql"
    fi
    
    # Restore MongoDB
    if [ -d "$backup_dir/mongodb_backup" ]; then
        docker-compose up -d mongodb
        sleep 10
        docker cp "$backup_dir/mongodb_backup" ongc-mongodb:/tmp/
        docker-compose exec -T mongodb mongorestore /tmp/mongodb_backup
    fi
    
    # Restart services
    docker-compose up -d
    
    print_status "Rollback completed."
}

# Main script
main() {
    case "${1:-deploy}" in
        "deploy")
            check_docker
            check_env_file
            validate_env
            deploy
            ;;
        "backup")
            backup
            ;;
        "rollback")
            rollback "$2"
            ;;
        "stop")
            print_status "Stopping services..."
            docker-compose down
            ;;
        "logs")
            docker-compose logs -f
            ;;
        "status")
            docker-compose ps
            ;;
        *)
            echo "Usage: $0 {deploy|backup|rollback <backup_dir>|stop|logs|status}"
            exit 1
            ;;
    esac
}

# Load environment variables
if [ -f ".env" ]; then
    export $(cat .env | grep -v '^#' | xargs)
fi

main "$@" 