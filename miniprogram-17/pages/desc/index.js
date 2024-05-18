// pages/desc/index.js
Page({

  /**
   * 页面的初始数据
   */
  data: {
    openid:'',
    item:'',
    tupianlist:[],
    isIOS:false,
    timeStamp: '支付接口返回的时间戳',
    nonceStr: '支付接口返回的随机字符串',
    pack: '支付接口返回的数据包',
    signType: '支付接口返回的签名算法',
    paySign: '支付接口返回的签名',
  },

  /**
   * 生命周期函数--监听页面加载
   */
  zhifu:function(event){ 
    const price=event.currentTarget.dataset
    console.log(price)
    console.log(wx.getStorageSync('openid'))
    wx.request({
      url: 'https://store.lilknee.xyz/zhifu',
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
              url: 'https://store.lilknee.xyz/setwjlist',
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



  previewImage: function (event) {
    const imageUrl = event.currentTarget.dataset.src; // 获取图片的链接
    wx.previewImage({
      current: imageUrl, // 当前显示图片的链接
      urls: [imageUrl]   // 需要预览的图片链接列表
    });
  },
  onLoad(options) {
    

    wx.login({
      success: res => {
        // 发送 res.code 到后台换取 openId, sessionKey, unionId
        wx.request({
          url: 'https://store.lilknee.xyz/getOpenId',
          method:'POST',
          data:{
            code:res.code
          },
          success: (response)=>{
            this.setData({openid:response.data[1].data.openid})
            
            
          },
        })
        
      },
      
    })
    

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
    const jsonData = options.data;
    console.log(options)
    console.log(jsonData)
    const complexObject = JSON.parse(decodeURIComponent(jsonData));
    console.log(complexObject);
    this.setData({
      item:complexObject.index2
    })
    wx.request({
      url: 'https://store.lilknee.xyz/getimage',
      method:'POST',
      data:{name:this.data.item.title},
      success:(res)=>{
        console.log(res)
        this.setData({tupianlist:res})
        console.log(this.data.tupianlist)
      }
    })

  },

  /**
   * 生命周期函数--监听页面初次渲染完成
   */
  onReady() {

  },

  /**
   * 生命周期函数--监听页面显示
   */
  onShow() {

  },

  /**
   * 生命周期函数--监听页面隐藏
   */
  onHide() {

  },

  /**
   * 生命周期函数--监听页面卸载
   */
  onUnload() {
    
  },

  /**
   * 页面相关事件处理函数--监听用户下拉动作
   */
  onPullDownRefresh() {

  },

  /**
   * 页面上拉触底事件的处理函数
   */
  onReachBottom() {

  },

  /**
   * 用户点击右上角分享
   */
  onShareAppMessage() {

  }
})