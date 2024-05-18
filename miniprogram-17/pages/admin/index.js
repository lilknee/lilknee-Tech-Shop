// pages/admin/index.js
Page({

  /**
   * 页面的初始数据
   */
  data: {
    openid:'',
    wjlist:[]
  },


  copy: function (event) {
    const wechatId = event.currentTarget.dataset.o; // 实际的微信号
    console.log(wechatId)
    wx.setClipboardData({
      data: wechatId,
      success: function () {
        wx.showToast({
          title: '已复制',
        });
      },
      fail: function () {
        wx.showToast({
          title: '复制失败',
          icon: 'none',
        });
      },
    });
  },
  downloadfile: function (event) {
    const url = event.currentTarget.dataset.download;
    console.log(url) // 获取按钮 data-url 属性值
    wx.downloadFile({
      url: url,
      success: function (res) {
        if (res.statusCode === 200) {
          console.log(res)
          
            wx.saveImageToPhotosAlbum({
              tempFilePath: res.tempFilePath,
              
              success: function (saveRes) {
                console.log('文件保存成功，本地路径：');
                // 可以在这里进行其他操作，如预览、分享等
              },
              fail: function (saveError) {
                console.log('文件保存失败');
              }
            })
          // 下载成功，继续处理
        } else {
          console.log('文件下载失败', res);
        }
      },
      fail: function (error) {
        console.log('下载请求失败', error);
      }
    });
  },
  /**
   * 生命周期函数--监听页面加载
   */
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
            wx.request({
              url: 'https://store.lilknee.xyz/getwjlist',
              method:'POST',
              data:{
                openid:this.data.openid
              },
              success:(res)=>{
                console.log(res)
                this.setData({wjlist:res.data})
              }
            })
            console.log(response.data)
            
          },
        })
        
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