#!/usr/bin/env bash
aws ecr get-login-password --region ap-south-1 | docker login --username AWS --password-stdin 494634321140.dkr.ecr.ap-south-1.amazonaws.com
docker build -t prod-sfu-gateway .
docker tag prod-sfu-gateway:latest 494634321140.dkr.ecr.ap-south-1.amazonaws.com/prod-sfu-gateway:latest
docker push 494634321140.dkr.ecr.ap-south-1.amazonaws.com/prod-sfu-gateway:latest
aws ecs update-service --service arn:aws:ecs:ap-south-1:494634321140:service/prod-hub/prod-sfu-gateway-service --force-new-deployment --cluster prod-hub --region ap-south-1