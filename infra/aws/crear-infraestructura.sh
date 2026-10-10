#!/usr/bin/env bash
# Crea la red, la base de datos y las 2 EC2 de Cofrial en AWS Academy (Learner Lab).
# Ejecutar en la terminal del Learner Lab (ya trae AWS CLI y credenciales) o en un equipo con AWS CLI configurado.
#
#   export DB_PASSWORD='UnaClaveSegura123'     # clave del usuario admin de RDS (mín. 8 caracteres)
#   export MI_IP='200.1.2.3/32'                # tu IP pública para SSH (https://checkip.amazonaws.com)
#   bash crear-infraestructura.sh
#
# Los identificadores creados quedan en recursos.env.
set -euo pipefail

REGION=${AWS_REGION:-us-east-1}
KEY=${KEY_NAME:-vockey}            # par de llaves que trae el Learner Lab
: "${DB_PASSWORD:?Define DB_PASSWORD}"
: "${MI_IP:?Define MI_IP (tu IP pública con /32)}"
export AWS_DEFAULT_REGION=$REGION
SALIDA="$(dirname "$0")/recursos.env"
tag() { echo "ResourceType=$1,Tags=[{Key=Name,Value=$2},{Key=Proyecto,Value=cofrial}]"; }
paso() { echo; echo "==> $*"; }

paso "VPC 10.0.0.0/16"
VPC=$(aws ec2 create-vpc --cidr-block 10.0.0.0/16 --tag-specifications "$(tag vpc cofrial-vpc)" --query Vpc.VpcId --output text)
aws ec2 modify-vpc-attribute --vpc-id "$VPC" --enable-dns-hostnames
aws ec2 modify-vpc-attribute --vpc-id "$VPC" --enable-dns-support

paso "Subredes (2 públicas, 2 privadas en ${REGION}a y ${REGION}b)"
subred() { aws ec2 create-subnet --vpc-id "$VPC" --cidr-block "$1" --availability-zone "$2" --tag-specifications "$(tag subnet "$3")" --query Subnet.SubnetId --output text; }
PUB_A=$(subred 10.0.1.0/24 "${REGION}a" cofrial-publica-a)
PUB_B=$(subred 10.0.2.0/24 "${REGION}b" cofrial-publica-b)
PRIV_A=$(subred 10.0.11.0/24 "${REGION}a" cofrial-privada-a)
PRIV_B=$(subred 10.0.12.0/24 "${REGION}b" cofrial-privada-b)
for s in "$PUB_A" "$PUB_B"; do aws ec2 modify-subnet-attribute --subnet-id "$s" --map-public-ip-on-launch; done

paso "Internet Gateway y tabla de rutas pública"
IGW=$(aws ec2 create-internet-gateway --tag-specifications "$(tag internet-gateway cofrial-igw)" --query InternetGateway.InternetGatewayId --output text)
aws ec2 attach-internet-gateway --vpc-id "$VPC" --internet-gateway-id "$IGW"
RT=$(aws ec2 create-route-table --vpc-id "$VPC" --tag-specifications "$(tag route-table cofrial-rt-publica)" --query RouteTable.RouteTableId --output text)
aws ec2 create-route --route-table-id "$RT" --destination-cidr-block 0.0.0.0/0 --gateway-id "$IGW" >/dev/null
for s in "$PUB_A" "$PUB_B"; do aws ec2 associate-route-table --route-table-id "$RT" --subnet-id "$s" >/dev/null; done
# Las subredes privadas quedan con la tabla principal de la VPC: solo tráfico local, sin salida a Internet.

paso "Security Groups encadenados"
sg() { aws ec2 create-security-group --vpc-id "$VPC" --group-name "$1" --description "$2" --tag-specifications "$(tag security-group "$1")" --query GroupId --output text; }
SG_WEB=$(sg sg-web "Cofrial app: HTTP/HTTPS publico, SSH admin")
SG_IOT=$(sg sg-iot "Cofrial nodo IoT: solo SSH admin")
SG_RDS=$(sg sg-rds "Cofrial RDS: MySQL solo desde sg-web")
aws ec2 authorize-security-group-ingress --group-id "$SG_WEB" --protocol tcp --port 80 --cidr 0.0.0.0/0 >/dev/null
aws ec2 authorize-security-group-ingress --group-id "$SG_WEB" --protocol tcp --port 443 --cidr 0.0.0.0/0 >/dev/null
aws ec2 authorize-security-group-ingress --group-id "$SG_WEB" --protocol tcp --port 22 --cidr "$MI_IP" >/dev/null
aws ec2 authorize-security-group-ingress --group-id "$SG_WEB" --protocol tcp --port 80 --source-group "$SG_IOT" >/dev/null
aws ec2 authorize-security-group-ingress --group-id "$SG_IOT" --protocol tcp --port 22 --cidr "$MI_IP" >/dev/null
aws ec2 authorize-security-group-ingress --group-id "$SG_RDS" --protocol tcp --port 3306 --source-group "$SG_WEB" >/dev/null

paso "Amazon RDS MySQL 8.0 (tarda unos 10 minutos)"
aws rds create-db-subnet-group --db-subnet-group-name cofrial-db-subnets \
  --db-subnet-group-description "Subredes privadas de Cofrial" --subnet-ids "$PRIV_A" "$PRIV_B" >/dev/null
VERSION=$(aws rds describe-db-engine-versions --engine mysql \
  --query "DBEngineVersions[?starts_with(EngineVersion, '8.0.')].EngineVersion | [-1]" --output text)
aws rds create-db-instance --db-instance-identifier cofrial-db --engine mysql --engine-version "$VERSION" \
  --db-instance-class db.t3.micro --allocated-storage 20 --storage-type gp2 \
  --master-username admin --master-user-password "$DB_PASSWORD" --db-name cofrial \
  --vpc-security-group-ids "$SG_RDS" --db-subnet-group-name cofrial-db-subnets \
  --no-publicly-accessible --no-multi-az --backup-retention-period 7 --storage-encrypted \
  --availability-zone "${REGION}a" >/dev/null

paso "EC2 (Ubuntu 24.04)"
AMI=$(aws ssm get-parameter --name /aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id --query Parameter.Value --output text)
APP=$(aws ec2 run-instances --image-id "$AMI" --instance-type t3.small --key-name "$KEY" \
  --subnet-id "$PUB_A" --private-ip-address 10.0.1.10 --security-group-ids "$SG_WEB" \
  --block-device-mappings 'DeviceName=/dev/sda1,Ebs={VolumeSize=16,VolumeType=gp3}' \
  --tag-specifications "$(tag instance cofrial-app)" --query 'Instances[0].InstanceId' --output text)
IOT=$(aws ec2 run-instances --image-id "$AMI" --instance-type t3.micro --key-name "$KEY" \
  --subnet-id "$PUB_B" --private-ip-address 10.0.2.10 --security-group-ids "$SG_IOT" \
  --tag-specifications "$(tag instance cofrial-iot)" --query 'Instances[0].InstanceId' --output text)
aws ec2 wait instance-running --instance-ids "$APP" "$IOT"

paso "IP elástica para la EC2 de aplicación"
EIP_ALLOC=$(aws ec2 allocate-address --domain vpc --query AllocationId --output text)
aws ec2 associate-address --instance-id "$APP" --allocation-id "$EIP_ALLOC" >/dev/null
APP_IP=$(aws ec2 describe-addresses --allocation-ids "$EIP_ALLOC" --query 'Addresses[0].PublicIp' --output text)
IOT_IP=$(aws ec2 describe-instances --instance-ids "$IOT" --query 'Reservations[0].Instances[0].PublicIpAddress' --output text)

paso "Esperando a que RDS esté disponible"
aws rds wait db-instance-available --db-instance-identifier cofrial-db
RDS=$(aws rds describe-db-instances --db-instance-identifier cofrial-db --query 'DBInstances[0].Endpoint.Address' --output text)

cat > "$SALIDA" <<EOF
VPC=$VPC
PUB_A=$PUB_A
PUB_B=$PUB_B
PRIV_A=$PRIV_A
PRIV_B=$PRIV_B
IGW=$IGW
SG_WEB=$SG_WEB
SG_IOT=$SG_IOT
SG_RDS=$SG_RDS
APP_INSTANCE=$APP
IOT_INSTANCE=$IOT
APP_IP=$APP_IP
IOT_IP=$IOT_IP
RDS_ENDPOINT=$RDS
EOF

echo
echo "Listo. Recursos guardados en $SALIDA"
echo "  App (IP elástica): http://$APP_IP   ssh -i labsuser.pem ubuntu@$APP_IP"
echo "  Nodo IoT:          ssh -i labsuser.pem ubuntu@$IOT_IP"
echo "  RDS endpoint:      $RDS"
