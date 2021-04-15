FROM node:14
WORKDIR /usr/src/app
COPY ./package*.json ./
COPY ./src ./src
COPY ./tsconfig.json .
COPY ./node_modules .
EXPOSE 8080
CMD [ "npm", "start" ]