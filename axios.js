import axios from 'axios';
import Cookies from 'js-cookie';  // Import thư viện js-cookie

let isRefreshing = false; // Biến để theo dõi trạng thái refresh token
let refreshSubscribers = []; // Danh sách các yêu cầu đang chờ refresh token
let globalController = new AbortController(); // Controller toàn cục để hủy tất cả yêu cầu

// Hàm để thêm yêu cầu vào hàng đợi khi đang refresh token
function subscribeTokenRefresh(callback) {
    refreshSubscribers.push(callback);
}

// Hàm để thực hiện lại các yêu cầu sau khi token được làm mới
function onRefreshed(newToken) {
    refreshSubscribers.forEach(callback => callback(newToken));
    refreshSubscribers = []; // Xóa hàng đợi
}

// Lấy Bearer token từ cookies
const getBearerTokenFromCookies = () => {
    return Cookies.get('access_token'); // Thay 'access_token' bằng tên cookie token thực tế của bạn
};

const getRefreshTokenFromCookies = () => {
    return Cookies.get('refresh_token');
}
const persitRefreshToken = (token) => {
    Cookies.set('refresh_token', token, { expires: 7 }); // Lưu refresh token trong 7 ngày
};

const persitAccessToken = (token) => {
    Cookies.set('access_token', token); // Lưu access token trong session
}
// Tạo một instance của Axios với Bearer token trong headers
const api = axios.create({
    baseURL: 'http://localhost:8001', // Đổi thành API thực tế của bạn
});

// Interceptor để thêm `signal` vào mỗi yêu cầu mới
api.interceptors.request.use((config) => {
    config.headers['Authorization'] = `Bearer ${getBearerTokenFromCookies()}`; // Cập nhật Bearer token từ cookies trước mỗi yêu cầu
    return config;
});

// Interceptor để xử lý refresh token khi gặp lỗi 401
api.interceptors.response.use(
    (response) => response,
    async (error) => {
        const originalRequest = error.config;

        // Nếu lỗi là 401 và không phải yêu cầu refresh token
        if (error.response?.status === 401 && !originalRequest._retry) {
            // Đánh dấu yêu cầu này đã thử lại để tránh loop
            originalRequest._retry = true;

            if (!isRefreshing) {
                isRefreshing = true;


                try {
                    const response = await axios.post(
                        'http://localhost:8001/api/v1/auth/refresh-token',
                        { /* dữ liệu refresh token */ },
                        {
                            signal: globalController.signal,
                            headers: {
                                'Authorization': `Bearer ${getRefreshTokenFromCookies()}`, // Thêm refresh token vào header
                            }
                        } // Đính kèm signal vào yêu cầu refresh token
                    );
                    console.log(response.data._data.access_token.token);
                    const newToken = response.data._data.access_token.token;
                    persitAccessToken(newToken); // Lưu token mới vào cookies
                    persitRefreshToken(response.data._data.refresh_token.token); // Lưu refresh token mới vào cookies
                    // Cập nhật token mới cho tất cả các yêu cầu chờ
                    isRefreshing = false;
                    // Đặt token mới vào các yêu cầu Axios tiếp theo
                    api.defaults.headers.common['Authorization'] = `Bearer ${newToken}`;
                    return new Promise((resolve) => {
                        resolve(api(originalRequest)); // Thực hiện lại yêu cầu ban đầu với token mới
                        // TThực hiện lại các yêu cầu đã bị hủy khi token mới có sẵn
                        onRefreshed(newToken);
                    });
                } catch (refreshError) {
                    if (refreshError.name === 'AbortError') {
                        console.log('Yêu cầu refresh token đã bị hủy');
                    } else {
                        console.error('Lỗi khi refresh token:', refreshError);
                    }
                    isRefreshing = false;
                    return Promise.reject(refreshError); // Trả về lỗi nếu không thể refresh
                }
            }

            // Nếu đang trong quá trình refresh token, thêm yêu cầu vào hàng đợi
            return new Promise((resolve) => {
                subscribeTokenRefresh((newToken) => {
                    originalRequest.headers['Authorization'] = `Bearer ${newToken}`;
                    resolve(api(originalRequest)); // Thực hiện lại yêu cầu khi token mới có sẵn
                });
            });
        }

        return Promise.reject(error); // Trả về lỗi nếu không phải lỗi 401
    }
);

export default api;
