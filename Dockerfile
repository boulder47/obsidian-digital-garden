FROM node:18 as base
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm install
COPY . .

FROM base as builder
WORKDIR /usr/src/app
RUN npm run dev
RUN npm rum build


FROM nginx:1.24
COPY ./nginx/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /usr/src/app /usr/share/nginx/html/
EXPOSE 8080

FROM scratch AS export-stage
COPY --from=builder /usr/src/app /tmp/
ENTRYPOINT [ "/tmp/main.js" ]

FROM scratch AS binaries
COPY --from=export-stage /tmp/main.js /

