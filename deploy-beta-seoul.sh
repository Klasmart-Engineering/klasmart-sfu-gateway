#!/usr/bin/env bash
aws ecr get-login-password --region ap-northeast-2 | docker login --username AWS --password-stdin 494634321140.dkr.ecr.ap-northeast-2.amazonaws.com
docker build -t beta-sfu-gateway .
docker tag beta-sfu-gateway:latest 494634321140.dkr.ecr.ap-northeast-2.amazonaws.com/beta-sfu-gateway:latest
docker push 494634321140.dkr.ecr.ap-northeast-2.amazonaws.com/beta-sfu-gateway:latest
aws ecs update-service --service arn:aws:ecs:ap-northeast-2:494634321140:service/beta-hub/beta-sfu-gateway-service --force-new-deployment --cluster beta-hub