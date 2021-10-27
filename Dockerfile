FROM node:14
WORKDIR /usr/src/app
COPY ./package*.json ./
RUN npm ci
RUN npm audit fix
COPY ./dist ./dist
COPY ./src ./src
COPY ./tsconfig.json .
EXPOSE 8080
CMD [ "npm", "start" ]