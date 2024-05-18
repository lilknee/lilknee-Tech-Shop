// index.js
// 获取应用实例

Page({
  data: {
    isIOS:false,
    scrollTop: undefined,
    productlist: [],
    active: 0,
    openid: '',
    timeStamp: '支付接口返回的时间戳',
    nonceStr: '支付接口返回的随机字符串',
    pack: '支付接口返回的数据包',
    signType: '支付接口返回的签名算法',
    paySign: '支付接口返回的签名',
  },
  onChange(event) {
    // event.detail 的值为当前选中项的索引
    this.setData({ active: event.detail });
  },
  onPageScroll(res) {
    this.setData({
      scrollTop: res.scrollTop
    })
  },

  jump:function(event){
    console.log(event)
    const item=event.currentTarget.dataset
    console.log(item)
    if (typeof item ==='string') {  
      
      return
    }
    console.log(item)
    const item2 = JSON.stringify(item);
    wx.navigateTo({
      url: '/pages/desc/index?data=' + encodeURIComponent(item2),
    })
  },

  zhifu:function(event){ 
    const price=event.currentTarget.dataset
    console.log(price)
    console.log(wx.getStorageSync('openid'))
    wx.request({
      url: 'https://域名加接口',
      method:'POST',
      data:{
        total_fee:price.index.price*100,
        
        openid:this.data.openid
      },
      success:(res)=>{
        console.log(res)
        this.setData({
          timeStamp:res.data['timeStamp'],
          nonceStr:res.data['nonceStr'],
          package:res.data['package'],
          signType:res.data['signType'],
    
          paySign:res.data['paySign']
        })
        const timeStamp = this.data.timeStamp;
          const nonceStr = this.data.nonceStr;
          const pack = this.data.package;
          const signType = this.data.signType;
          const paySign = this.data.paySign;
        wx.requestPayment({
          "timeStamp": timeStamp,
            "nonceStr": nonceStr,
            "package": pack,
            "signType": signType,
            "paySign": paySign,
          success:(res)=>{
            
            wx.request({
              url: 'https://域名加接口',
              method:'POST',
              data:{
                openid:this.data.openid,
                download:price.index.download,
                name:price.index.title
              },
              success:(res)=>{
                console.log(res)
              }

            })
          },
          fail:()=>{
            console.log(res)
            console.log(this.data.productlist,this.data.productlist)
          }
        })
        
      },
      
    })
  },

  


  onLoad() {
    wx.getSystemInfo({
      success: (res) => {
        // 判断用户的系统平台
        console.log(res.platform)
        if (res.platform === 'ios') {
          this.setData({
            isIOS: true,
          });
        }
      }
    });


    wx.login({
      success: res => {
        // 发送 res.code 到后台换取 openId, sessionKey, unionId
        wx.request({
          url: 'https://域名加接口',
          method:'POST',
          data:{
            code:res.code
          },
          success: (response)=>{
            this.setData({openid:response.data[1].data.openid})
            console.log(response.data)
            
          },
        })
        
      }
    })


  wx.request({
    url: 'https://域名加接口',
    method:'POST',
    success:(res)=>{
      this.setData({
        productlist:res.data.product_list
      })
      
    }
  })
  
  },
 
})
