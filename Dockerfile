FROM node 

WORKDIR /server_login

COPY . .

RUN npm install

EXPOSE 3000

CMD [ "node", "app.js" ]

