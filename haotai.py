from email import header, message
from urllib.parse import urlparse
from minio import Minio

import xml.etree.ElementTree as ET
from crypt import methods
from tabnanny import check
from flask import Flask, request, jsonify
import urllib.parse as parse
from datetime import datetime,timedelta
from flask_sqlalchemy import SQLAlchemy
import requests,json,hashlib,time,random,string,uuid
from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives import serialization, hashes
from cryptography.hazmat.primitives.asymmetric import padding,utils
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric.utils import Prehashed
import base64


app = Flask(__name__)

# 数据库配置
# # 用户名
user = 'root'#改为自己数据库的用户名
# 密码
password = parse.quote_plus('自己数据库的密码')
# 表名
database = 'store'#改为自己的

sqlurl = 'mysql.lilknee.xyz'#改为自己的
app.config['SQLALCHEMY_DATABASE_URI'] = 'mysql+pymysql://%s:%s@%s:3306/%s' % (
    user, password, sqlurl, database)
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = True

db = SQLAlchemy(app)

class wjlist(db.Model):
    __tablename__ = 'wjlist'
    id = db.Column(db.Integer, primary_key=True)
    openid= db.Column(db.String(128),unique=True)
    download = db.Column(db.String(128),unique=True)
    name=db.Column(db.String(128),unique=True)

class image(db.Model):
    # 商品
    __tablename__ = 'image'
    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(128),unique=True)
    image = db.Column(db.String(128),unique=True)

class store(db.Model):
    # 商品
    __tablename__ = 'store'
    id = db.Column(db.Integer, primary_key=True)
    price= db.Column(db.Integer,index=True)
    descs= db.Column(db.String(128),unique=True)
    title = db.Column(db.String(128),unique=True)
    thumb = db.Column(db.String(128),unique=True)
    download = db.Column(db.String(128),unique=True)

minio_config = {
    'url': 'minio.lilknee.xyz:9000',
    'accesskey': 'WoGzginDs58QJFhf',
    'secretkey': 'hQD65KrZYKJm5PrTyrHHYG2aukmtHu2Y',
    'bucketName': 'aurora'

}

minio_client = Minio(minio_config['url'], access_key=minio_config['accesskey'], secret_key=minio_config['secretkey'], secure=False)
@app.route('/upload', methods=['POST'])
def upload_file():
    if 'file' not in request.files:
        print('No file part')
        return jsonify({'error': 'No file part'}), 400

    file = request.files['file']
    print(request.files)
    if file.filename == '':
        print('No selected file')
        return jsonify({'error': 'No selected file'}), 400

    try:
        # 在此处执行上传操作
        file_name = file.filename
        print(file_name)
        size_str = request.form.get('size')
        size = int(size_str)
        print(size)

        # 使用 MinIO 客户端上传文件
        
        minio_client.put_object(
            minio_config['bucketName'],
            file_name,
            file,  # 使用文件流上传
            size,
              # 设置文件类型        
        )
        print(file.content_length)  
        
        # 如果上传成功，返回一个成功消息
        print('File uploaded successfully')
        return jsonify({'message': 'File uploaded successfully'}), 200
    except Exception as err:
        print(f'Error uploading file: {err}')
        return jsonify({'error': f'Error uploading file: {err}'}), 500



@app.route('/getimage', methods=['POST'])
def get_image():
    data=request.get_json() 
    name=data.get('name')
    imagelist_obj = image.query.filter_by(title=name).order_by(image.id.desc()).all()
    
    if imagelist_obj:
        wjlist_list=[]
        for imagelist_obj in imagelist_obj:
                wjlist_list.append({
                    'url': imagelist_obj.image,
                })
        return jsonify(wjlist_list)
                
            
    else:
        return 'weikong'
    

@app.route('/setwjlist', methods=['POST'])
def set_wjlistdb():
    data = request.get_json() 
    print(data)
    openid=data.get('openid')
    download=data.get('download')
    name=data.get('name')
    new_sp = wjlist(openid=openid, download=download,name=name)    
    db.session.add(new_sp)
    db.session.commit()
    return 'cg'

@app.route('/setimagedb', methods=['POST'])
def set_imagedb():
    data = request.get_json() 
    print(data)
    print(666)
    
    if 'dizhi' in data:
        dizhi_list = data['dizhi']
        title=data['name']
        
        # 确保 dizhi_list 不为空
        if dizhi_list:
            for item in dizhi_list:
                final_url = item.get('finalUrl')
                
                # 使用 final_url 作为 image
                new_sp = image(title=title, image=final_url)
                
                db.session.add(new_sp)
                db.session.commit()
                
                # 在这里，您可以使用 final_url 做任何您需要的操作
                print(final_url)
    else:
        print('No "dizhi" key in the data') 
    
    return 'cg'



@app.route('/setdb', methods=['POST'])
def set_db():
    data=request.get_json() 
    print(data)
    openid=data.get('openid')
    price=data.get('price')
    descs=data.get('descs')
    title=data.get('title')
    thumb=data.get('thumb')
    download=data.get('download')
    new_sp = store(price=price, descs=descs,title=title,thumb=thumb,download=download)
    db.session.add(new_sp)
    db.session.commit()
    return 'cg'


@app.route('/getproducts', methods=['POST'])
def get_products():
	print(888)
	return "666"


@app.route('/getwjlist', methods=['POST'])
def get_wjlist():
    data=request.get_json() 
    openid=data.get('openid')
    print(openid)
    wjlist_obj = wjlist.query.filter_by(openid=openid).order_by(wjlist.id.desc()).all()
    
    if wjlist_obj:
        wjlist_list=[]
        for wjlist_obj in wjlist_obj:
                wjlist_list.append({
                    'download': wjlist_obj.download,
                    'name': wjlist_obj.name
                })
        return jsonify(wjlist_list)
                
            
    else:
        return 'weikong'



@app.route('/getproduct', methods=['POST'])
def get_product():
    try:
        # 查询数据库中的所有信息
        all_products = store.query.all()
        print(all_products)
        # 转换为适合的数据格式（字典列表）
        product_list = []
        for product in all_products:
            product_data = {
                'id': product.id,
                'price': product.price,
                'descs': product.descs,
                'title': product.title,
                'thumb':product.thumb,
                'download':product.download
            }
            product_list.append(product_data)
        
        # 返回数据
        print(product_list)
        return jsonify({'product_list': product_list})
    except Exception as e:
        print("000")
        error_msg = "An error occurred: " + str(e)
        print(error_msg)
        return jsonify({'error': error_msg})


@app.route('/getOpenId', methods=['POST'])
def get_open_id():
    code = request.json.get('code')
    if not code:
        return jsonify({'error': 'Missing code parameter'}), 400

    # 调用微信登录凭证校验接口，获取 OpenID 和 session_key
    url = 'https://api.weixin.qq.com/sns/jscode2session'
    params = {
        'appid': 'wxe9b45e1f2f56d13a',#你的小程序 AppID
        'secret': 'c2d28b1a911159664c006cf2b4d1ed70',#你的小程序 AppSecret
        'js_code': code,
        'grant_type': 'authorization_code'
    }

    response = requests.get(url, params=params)
    data = response.json()
    return jsonify({'message': '成功获取成功'},{'data':data})



@app.route('/zhifu', methods=['POST'])
def get_money():
    # 获取支付金额
    data = request.get_json()
    # 获取支付金额
    total_fee = data.get('total_fee')
    openid=data.get('openid')
    print(openid)

    # 调用 get_payment_params 函数获取支付参数
    payment_params = get_payment_params(total_fee,openid)

    # 返回支付参数给前端
    return jsonify(payment_params)

def generate_xml(params):
    root = ET.Element("xml")
    for key, value in params.items():
        child = ET.Element(key)
        child.text = str(value)
        root.append(child)
    return ET.tostring(root, encoding="utf-8")

def get_canonical_url(url):
    parsed_url = urlparse(url)
    canonical_url = parsed_url.path
    print(canonical_url)
    if parsed_url.query:
        canonical_url += '?' + parsed_url.query
    return canonical_url

def build_message(methods, url, Timestamp, nonce_str, body):
    canonical_url = get_canonical_url(url)
    bodys=json.dumps(body)
    return f'{methods}\n{canonical_url}\n{str(Timestamp)}\n{nonce_str}\n{bodys}'
def sign(message, private_key_path):
    print(message)
    # 读取私钥文件
    with open(private_key_path, "rb") as key_file:
        private_key = serialization.load_pem_private_key(key_file.read(), password=None, backend=default_backend())

    # 使用 SHA-256 哈希算法对消息进行摘要处理
    digest = hashes.Hash(hashes.SHA256(), backend=default_backend())
    digest.update(message)
    message_digest = digest.finalize()

    # 使用 SHA256withRSA 算法进行签名
    signer = private_key.sign(
        message_digest,
        padding.PKCS1v15(),
        hashes.SHA256()  # Pass the hash algorithm explicitly
    )

    # 对签名结果进行 Base64 编码
    signature = base64.b64encode(signer).decode("utf-8")
    return signature

# 定义获取支付参数的函数
def get_payment_params(total_fee,openid):
    # 这里假设你已经有了微信支付的商户号、APPID、密钥等信息
    appid = 'wxe9b45e1f2f56d13a'#改为自己的
    mch_id = '1649026631'#改为自己的改为自己的
    api_key = 'aB3DfG5hIj8Km1N4pQrS7tUvW9XyZ2C6'#改为自己的
    Timestamp=str(int(time.time()))
    print(Timestamp)
    nonce_str=generate_random_string(32).upper()
    # 组装支付参数
    tarde_no=str(uuid.uuid4().hex)
    params = {
        'appid': 'wxe9b45e1f2f56d13a',#改为自己的
        'mch_id': '1649026631',#改为自己的
        'device_info':'013467007045764',
        'nonce_str':nonce_str,
        'body': 'lilknee的网络工作室-餐饮、零售批发、交通出行、生活娱乐服务',
        'out_trade_no': tarde_no,
        'total_fee': total_fee,
        'spbill_create_ip':'123.12.12.123',
        'notify_url': 'https://www.weixin.qq.com/wxpay/pay.php',  
        'trade_type':'JSAPI',
        'openid':openid,    
    }

    # 对支付参数进行签名，保证数据安全性
    #sign = generate_sign(payment_params, api_key)
    
    #payment_params['sign'] = sign
    print(params)
    
    signs=generate_sign(params,api_key)
    params['sign']=signs
    print(signs)
    print(params)

    # 调用统一下单接口，获取预支付ID（prepay_id）
    prepay_id = get_prepay_id(params,Timestamp,nonce_str,signs)
    
    # 组装支付参数，用于前端调用微信支付接口
    params = {
        'appId': appid,
        'timeStamp': Timestamp,
        'nonceStr': nonce_str,  # 这里可以使用随机字符串生成函数
        'package': 'prepay_id=' + prepay_id,
        'signType': 'MD5',
        'paySign':''
    }

    # 对支付参数进行签名，保证数据安全性
    pay_sign = generate_sign(params, api_key)
    print(pay_sign)
    params['paySign'] = pay_sign
    print(params)

    return params
#生成随机数函数
def generate_random_string(length):
    letters_and_digits = string.ascii_letters + string.digits
    return ''.join(random.choice(letters_and_digits) for i in range(length))

# 生成签名函数
def generate_sign(params, app_key):
    # 对参数按照字母顺序排序
    sorted_params = sorted(params, key=lambda x: x.lower())

    # 将排序后的参数拼接成字符串
    stringA = "&".join([f"{param}={params[param]}" for param in sorted_params if params[param]])
    print(stringA)

    # 在字符串末尾拼接上key
    stringSignTemp = f"{stringA}&key={app_key}"
    print(stringSignTemp)

    # 使用MD5对拼接后的字符串进行哈希运算，生成签名，并转换为大写
    sign = hashlib.md5(stringSignTemp.encode('utf-8')).hexdigest().upper()

    return sign

# 调用微信统一下单接口，获取预支付ID（prepay_id）
def get_prepay_id(params,Timestamp,nonce_str,signs):
    print(nonce_str)
    # 组装统一下单接口的URL
    unified_order_url = 'https://api.mch.weixin.qq.com/pay/unifiedorder'
    #params_str = json.dumps(params)
    xml_data = generate_xml(params)
    methods='POST'
    body = signs
    message=build_message(methods,unified_order_url,str(Timestamp),str(nonce_str),body).encode('utf-8')
    print(message)
    private_key_path = "/usr/local/www/private_key.pem"  # 替换成你的私钥文件路径
    Signature = sign(message, private_key_path)
    print(Signature)
    auther='WECHATPAY2-SHA256-RSA2048 mchid="1649026631",nonce_str="{{nonce_str}}",signature="{{sign}}",timestamp="{{Timestamp}}",serial_no="5CEAA249CC38A1E094F22859049CD55BF17FAA53"'
    authorization=auther.format(nonce_str=str(nonce_str),sign=str(Signature),Timestamp=str(Timestamp))
    headers={
        'Content-Type':'application/xml',
        
        #'Authorization':authorization
    }
    # 发起POST请求，获取预支付ID
    response = requests.post(unified_order_url,headers=headers, data=xml_data)
    print(response.content)
    xml_str=response.content
    res=xml_to_dict(xml_str)
    print(res)
    response_data = res
    
    print(response_data)
    prepay_id = response_data.get('prepay_id')
    print(prepay_id)
    return prepay_id

# 将XML格式转换为字典格式
def xml_to_dict(xml_str):
    xml_dict = {}
    root = ET.fromstring(xml_str)
    for child in root:
        xml_dict[child.tag] = child.text
    return xml_dict


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8066)



























