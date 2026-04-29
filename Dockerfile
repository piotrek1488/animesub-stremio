# Use a lightweight version of Python
FROM python:3.11-slim

# Set up a working directory inside the container
WORKDIR /app

# Copy the library list file
COPY requirements.txt .

# Install dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy the remaining project files
COPY . .

# Expose the port on which uvicorn is running
EXPOSE 8080

# Startup command
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]
