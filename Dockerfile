FROM node:lts-alpine
WORKDIR /usr/src/app
COPY ./package*.json ./
COPY ./.npmrc ./.npmrc
ARG NODE_AUTH_TOKEN
RUN npm config set npat true
RUN npm set //npm.pkg.github.com/:_authToken $NODE_AUTH_TOKEN
RUN npm ci
RUN npm audit fix
COPY ./dist ./dist
COPY ./src ./src
COPY ./tsconfig.json .
EXPOSE 8080
CMD [ "npm", "start" ]
