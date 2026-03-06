FROM node:20-alpine

WORKDIR /app

# Kopiuj pliki package
COPY package*.json ./

# Instaluj zależności
RUN npm ci --only=production

# Kopiuj resztę plików
COPY . .

# Hugging Face wymaga portu 7860
ENV PORT=7860
ENV BASE_URL=""

EXPOSE 7860

# Uruchom addon
CMD ["npm", "start"]
